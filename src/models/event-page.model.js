const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * A block on an event's public page.
 *
 * Two kinds live in the same array. BOUND blocks (tickets, venue, organizer,
 * reviews, countdown, resale, progress, phase) hold only presentation props. Their content is
 * read from the event at render time, so moving a venue updates every page
 * without anyone editing them. FREE blocks (hero, text, lineup, gallery,
 * video, faq, sponsors) carry their own content in `props`.
 */
const blockSchema = new Schema(
  {
    // Client-generated so drag-reordering never has to wait on a round trip.
    id: { type: String, required: true, trim: true, maxlength: 40 },
    type: {
      type: String,
      required: true,
      enum: [
        "hero",
        "text",
        "lineup",
        "gallery",
        "video",
        "faq",
        "sponsors",
        "tickets",
        "venue",
        "countdown",
        "organizer",
        "reviews",
        "resale",
        "progress",
        "phase",
        "footer",
      ],
    },
    // Shape varies by type; validated per-type in the service rather than here,
    // so adding a block does not require a schema migration.
    props: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const themeSchema = new Schema(
  {
    preset: {
      type: String,
      enum: ["paper", "midnight", "ink", "sun", "noir", "forest", "plum", "ocean", "bloom", "slate", "sand", "mint"],
      default: "paper",
    },
    accent: { type: String, trim: true, default: "" },
    font: {
      type: String,
      enum: ["gilroy", "editorial", "poster", "brutal", "soft", "club", "modern", "classic", "condensed", "quirky", "statement", "humanist"],
      default: "gilroy",
    },
  },
  { _id: false },
);

const eventPageSchema = new Schema(
  {
    eventId: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
      unique: true,
      index: true,
    },
    organizerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // The public address. Lowercased and uniquely indexed, because it is the
    // only thing a poster or a shared link has to go on.
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    // Slugs a page has answered to before. Kept so printed links never die.
    previousSlugs: [{ type: String, trim: true, lowercase: true }],
    theme: { type: themeSchema, default: () => ({}) },
    blocks: { type: [blockSchema], default: [] },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },
    seo: {
      title: { type: String, trim: true, maxlength: 120, default: "" },
      description: { type: String, trim: true, maxlength: 300, default: "" },
      imageUrl: { type: String, trim: true, maxlength: 600, default: "" },
      indexable: { type: Boolean, default: true },
    },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

eventPageSchema.index({ previousSlugs: 1 });

module.exports = mongoose.model("EventPage", eventPageSchema);
