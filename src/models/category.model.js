const { Schema, model } = require("mongoose");
const slugify = require("slugify");
const { CATEGORY_ICON_KEYS } = require("../validations/category.validation");

const categorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    iconKey: {
      type: String,
      required: true,
      enum: CATEGORY_ICON_KEYS,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
      default: "",
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    // Soft-hide only — never hard-deleted, since events may already
    // reference a category by id via Event.categoryIds.
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.__v;
        return ret;
      },
    },
  },
);

categorySchema.index({ isActive: 1, sortOrder: 1 });

categorySchema.pre("validate", function preValidate() {
  if (this.isModified("name") || !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true, trim: true });
  }
});

const Category = model("Category", categorySchema);

module.exports = Category;
