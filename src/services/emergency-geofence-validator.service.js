const ApiError = require("../utils/api-error");
const { haversineDistanceMeters, toCheckInWindow, resolveOccurrenceWindow } = require("./event.service");

// GPS fixes worse than this are treated as "no meaningful location" —
// the practical spoofing/garbage-data guard available without device
// attestation. Documented judgment call, not derived from a spec value.
const MAX_ACCEPTABLE_ACCURACY_METERS = 100;

/**
 * The Geofence Validator — a separate, focused module so eligibility rules
 * (checked-in, inside geofence, event active, GPS sanity) can be reasoned
 * about and tested independently of report persistence or scoring.
 */
const ensureAttendeeEligibleToReport = ({
  event,
  ticket,
  actorUserId,
  latitude,
  longitude,
  gpsAccuracy,
  now = new Date(),
}) => {
  if (String(ticket.buyerUserId) !== String(actorUserId)) {
    throw new ApiError(403, "You can only report an emergency for your own ticket");
  }

  if (ticket.status !== "used") {
    throw new ApiError(
      409,
      "You must be checked in to report an emergency",
      null,
      "TICKET_NOT_CHECKED_IN",
    );
  }

  if (event.emergency?.enabled === false) {
    throw new ApiError(409, "Emergency reporting is not enabled for this event", null, "EMERGENCY_REPORTING_DISABLED");
  }

  if (event.status !== "published") {
    throw new ApiError(409, "Only published events accept emergency reports", null, "EVENT_NOT_ACTIVE");
  }

  const window = toCheckInWindow(event, now);
  const occurrence = resolveOccurrenceWindow(event, now);
  const activeEndsAt = occurrence?.endsAt ?? new Date(event.endsAt);

  if (now < window.opensAt || now > activeEndsAt) {
    throw new ApiError(
      409,
      "Emergency reports are only accepted while the event is active",
      { opensAt: window.opensAt, endsAt: activeEndsAt },
      "EVENT_NOT_ACTIVE",
    );
  }

  if (
    gpsAccuracy === null ||
    gpsAccuracy === undefined ||
    Number(gpsAccuracy) > MAX_ACCEPTABLE_ACCURACY_METERS
  ) {
    throw new ApiError(
      400,
      "Your location signal is too weak to verify — move to an open area and try again",
      { maxAcceptableAccuracyMeters: MAX_ACCEPTABLE_ACCURACY_METERS },
      "LOCATION_ACCURACY_TOO_LOW",
    );
  }

  const allowedRadiusMeters = event.emergency?.geofenceRadiusMeters ?? event.geofenceRadiusMeters;
  const distanceMeters = haversineDistanceMeters(
    latitude,
    longitude,
    event.latitude,
    event.longitude,
  );

  if (distanceMeters > allowedRadiusMeters) {
    throw new ApiError(
      409,
      "You appear to be outside the event location",
      {
        distanceMeters: Math.round(distanceMeters),
        allowedRadiusMeters,
      },
      "OUTSIDE_EVENT_GEOFENCE",
    );
  }

  return { distanceMeters };
};

module.exports = {
  ensureAttendeeEligibleToReport,
  MAX_ACCEPTABLE_ACCURACY_METERS,
};
