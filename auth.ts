import { Tariff, UserGroup, Charger } from "./schema";

interface Result {
  allowed: boolean;
  reason?: string;
  ratePerKwh?: number;
}

export async function authorizeAndPrice(
  userId: string,
  chargerId: string,
  time: Date
): Promise<Result> {
  try {
    // Get charger details
    const charger = await Charger.findById(chargerId).populate("site");
    if (!charger) {
      return { allowed: false, reason: "Charger not found" };
    }

    // Handle private non-billable chargers
    if (
      charger.accessType === "private" &&
      charger.billableType === "non_billable"
    ) {
      return { allowed: true, ratePerKwh: 0 };
    }

    // Find user's groups
    const userGroups = await UserGroup.find({ users: userId });
    if (userGroups.length === 0) {
      return { allowed: false, reason: "User has no group membership" };
    }

    // Check if any of user's groups have access to the charger's site
    const authorizedGroups = userGroups.filter((group) =>
      group.accessibleSites.some(
        (siteId) => siteId.toString() === charger.site.toString()
      )
    );

    if (authorizedGroups.length === 0) {
      return {
        allowed: false,
        reason: "User's groups do not have access to this site",
      };
    }

    // Find tariffs for this charger that apply to user's authorized groups
    const applicableTariffs = await Tariff.find({
      charger: chargerId,
      group: { $in: authorizedGroups.map((g) => g._id) },
    });

    if (applicableTariffs.length === 0) {
      return {
        allowed: false,
        reason: "No pricing tariff available for this charger",
      };
    }

    // Find best rate (lowest) - most favorable for user
    let bestRate = applicableTariffs[0].ratePerKwh;

    for (const tariff of applicableTariffs) {
      let effectiveRate = tariff.ratePerKwh;

      // Check if this tariff has time based pricing rules
      if (tariff.timeRules) {
        // Get the current hour (0-23) to match against time rules
        const currentHour = time.getHours();

        // Find the time rule that applies to the current hour
        const timeRule = tariff.timeRules.find(
          (rule) => currentHour >= rule.startHour && currentHour < rule.endHour
        );

        if (timeRule) {
          // Apply the time rule's rate multiplier to get the effective rate
          // For example, if rateMultiplier is 0.5, this gives a 50% discount
          effectiveRate *= timeRule.rateMultiplier;
        }
      }

      // Keep the lowest rate
      if (effectiveRate < bestRate) {
        bestRate = effectiveRate;
      }
    }

    return { allowed: true, ratePerKwh: bestRate };
  } catch (error) {
    console.error("Authorization error:", error);
    return { allowed: false, reason: "System error occurred" };
  }
}

/*
DECISIONS MADE:
- Site access check: Filter user's groups to only those with site access BEFORE checking tariffs
- Missing tariff data: Return 'No pricing tariff available' instead of allowing free charging
- Multiple groups: Pick lowest rate (most user-friendly)
- Time rules: Applied as multipliers to base rate
- Error handling: Wrapped in try-catch to prevent crashes
- Private non-billable: Special case with rate = 0
- Access control: Two-step verification (site access + tariff existence)
*/
