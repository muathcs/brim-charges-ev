import mongoose, { Schema, Document } from "mongoose";

// Enums for type safety
export enum AccessType {
  PUBLIC = "public",
  COMMUNAL = "communal",
  PROTECTED = "protected",
  PRIVATE = "private",
}

export enum BillableType {
  BILLABLE = "billable",
  NON_BILLABLE = "non_billable",
}

// 0. User Schema
export interface IUser extends Document {
  name: string;
  groups: mongoose.Types.ObjectId[]; // Reference to user groups
}

const UserSchema = new Schema<IUser>({
  name: { type: String, required: true },
  groups: [{ type: Schema.Types.ObjectId, ref: "UserGroup" }],
});

// 1. User Group Schema
export interface IUserGroup extends Document {
  name: string;
  description?: string;
  users: mongoose.Types.ObjectId[]; // Reference to users
  accessibleSites: mongoose.Types.ObjectId[]; // Reference to sites
}

const UserGroupSchema = new Schema<IUserGroup>({
  name: { type: String, required: true },
  description: String,
  users: [{ type: Schema.Types.ObjectId, ref: "User" }],
  accessibleSites: [{ type: Schema.Types.ObjectId, ref: "Site" }],
});

// 2. Site Schema
export interface ISite extends Document {
  name: string;
  location: {
    address: string;
    coordinates?: [number, number];
  };
  chargers: mongoose.Types.ObjectId[]; // reference to chargers
}

const SiteSchema = new Schema<ISite>({
  name: { type: String, required: true },
  location: {
    address: { type: String, required: true },
    coordinates: [Number],
  },
  chargers: [{ type: Schema.Types.ObjectId, ref: "Charger" }],
});

// 3. Charger Schema
export interface ICharger extends Document {
  site: mongoose.Types.ObjectId;
  accessType: AccessType;
  billableType?: BillableType;
  powerOutput: number; // kW
  tariffs: mongoose.Types.ObjectId[]; // Different rates for different groups
}

const ChargerSchema = new Schema<ICharger>({
  site: { type: Schema.Types.ObjectId, ref: "Site", required: true },
  accessType: { type: String, enum: AccessType, required: true },
  billableType: { type: String, enum: BillableType },
  powerOutput: { type: Number, required: true },
  tariffs: [{ type: Schema.Types.ObjectId, ref: "Tariff" }],
});

// 4. Tariff Schema (pricing rules)
export interface ITariff extends Document {
  charger: mongoose.Types.ObjectId;
  group: mongoose.Types.ObjectId; // Which group this rate applies to
  ratePerKwh: number;
  timeRules?: {
    startHour: number; // 0-23
    endHour: number; // 0-23
    rateMultiplier: number; // e.g., 0.5 for half price
  }[];
}

const TariffSchema = new Schema<ITariff>({
  charger: { type: Schema.Types.ObjectId, ref: "Charger", required: true },
  group: { type: Schema.Types.ObjectId, ref: "UserGroup", required: true },
  ratePerKwh: { type: Number, required: true },
  timeRules: [
    {
      startHour: { type: Number, min: 0, max: 23 },
      endHour: { type: Number, min: 0, max: 23 },
      rateMultiplier: { type: Number, default: 1 },
    },
  ],
});

// Add compound unique index to prevent multiple tariffs for same charger+group
TariffSchema.index({ charger: 1, group: 1 }, { unique: true });

// 5. Charging Session Schema
export interface IChargingSession extends Document {
  user: mongoose.Types.ObjectId;
  charger: mongoose.Types.ObjectId;
  startTime: Date;
  endTime?: Date;
  kWhConsumed: number;
  totalCost: number;
  group: mongoose.Types.ObjectId; // Which group was used for pricing
}

const ChargingSessionSchema = new Schema<IChargingSession>({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  charger: { type: Schema.Types.ObjectId, ref: "Charger", required: true },
  startTime: { type: Date, required: true },
  endTime: Date,
  kWhConsumed: { type: Number, required: true },
  totalCost: { type: Number, required: true },
  group: { type: Schema.Types.ObjectId, ref: "UserGroup", required: true },
});

// Export models
export const User = mongoose.model<IUser>("User", UserSchema);
export const UserGroup = mongoose.model<IUserGroup>(
  "UserGroup",
  UserGroupSchema
);
export const Site = mongoose.model<ISite>("Site", SiteSchema);
export const Charger = mongoose.model<ICharger>("Charger", ChargerSchema);
export const Tariff = mongoose.model<ITariff>("Tariff", TariffSchema);
export const ChargingSession = mongoose.model<IChargingSession>(
  "ChargingSession",
  ChargingSessionSchema
);

/*
ACCESS CONTROL MODEL:
- Users belong to Groups (many-to-many)
- Groups have access to Sites (many-to-many)
- Sites contain Chargers
- Chargers have access types (Public, Communal, Protected, Private)
- Private chargers can be billable/non-billable

PRICING DETERMINATION:
1. Find user's groups
2. Check if any group has access to the charger's site
3. Find the tariff for that group + charger combination
4. Apply time-based rules if they exist
5. For multiple groups: pick the lowest rate (most favorable for user)

TRADEOFF: 
- Complexity vs. flexibility: The tariff system allows more control but requires more database queries
- Chose separate Tariff collection over embedded rates for easier updates and time-based pricing
- Compound unique index on Tariff (charger + group) prevents ambiguous pricing scenarios
*/
