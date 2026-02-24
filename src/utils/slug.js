const slugify = require("slugify");

const makeWorkspaceSlug = (name) => {
  const baseSlug = slugify(name, {
    lower: true,
    strict: true,
    trim: true,
  });

  const suffix = Math.random().toString(36).slice(2, 7);
  return `${baseSlug}-${suffix}`;
};

module.exports = {
  makeWorkspaceSlug,
};
