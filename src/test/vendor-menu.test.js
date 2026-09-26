const vendorService = require("../services/vendor.service");
const VendorItem = require("../models/vendor-item.model");
const Vendor = require("../models/vendor.model");
const { createUser } = require("./fixtures");

const newVendor = (actorUserId, overrides = {}) =>
  vendorService.createVendor({
    actorUserId,
    payload: {
      businessName: "Mama Put Express",
      categories: ["food", "drinks"],
      city: "Lagos",
      ...overrides,
    },
  });

const newItem = (actorUserId, overrides = {}) =>
  vendorService.createItem({
    actorUserId,
    payload: {
      name: "Jollof rice & chicken",
      category: "food",
      priceNaira: 4500,
      ...overrides,
    },
  });

describe("vendor account", () => {
  test("a vendor is created with a slug and the categories they picked", async () => {
    const user = await createUser();
    const vendor = await newVendor(user._id);

    expect(vendor.businessName).toBe("Mama Put Express");
    expect(vendor.slug).toMatch(/^mama-put-express-[a-z0-9]{5}$/);
    expect(vendor.categories).toEqual(["food", "drinks"]);
    expect(vendor.categoryLabels).toEqual(["Food", "Drinks"]);
    // Nothing can be sold until a payout account is confirmed.
    expect(vendor.payoutReady).toBe(false);
    expect(vendor.verificationLevel).toBe("starter");
  });

  test("one vendor account per user", async () => {
    const user = await createUser();
    await newVendor(user._id);

    await expect(newVendor(user._id)).rejects.toMatchObject({
      statusCode: 409,
      code: "VENDOR_ALREADY_EXISTS",
    });
  });

  test("a made-up category is refused, and duplicates are collapsed", async () => {
    const user = await createUser();

    await expect(
      newVendor(user._id, { categories: ["food", "fireworks"] }),
    ).rejects.toThrow(/Unknown category/);

    const vendor = await newVendor(user._id, { categories: ["food", "food"] });
    expect(vendor.categories).toEqual(["food"]);
  });

  test("renaming the business keeps the slug, so shared links still work", async () => {
    const user = await createUser();
    const created = await newVendor(user._id);

    const renamed = await vendorService.updateVendor({
      actorUserId: user._id,
      payload: { businessName: "Mama Put Deluxe" },
    });

    expect(renamed.businessName).toBe("Mama Put Deluxe");
    expect(renamed.slug).toBe(created.slug);
  });

  test("someone with no vendor account gets null, not an error", async () => {
    const user = await createUser();

    await expect(
      vendorService.getMyVendor({ actorUserId: user._id }),
    ).resolves.toBeNull();
  });
});

describe("menu", () => {
  test("an item carries both a Vera category and the vendor's own section", async () => {
    const user = await createUser();
    await newVendor(user._id);

    const withSection = await vendorService.addSection({
      actorUserId: user._id,
      payload: { name: "Mains" },
    });
    const mains = withSection.sections[0];

    const item = await newItem(user._id, { sectionId: mains._id });

    expect(item.category).toBe("food");
    expect(item.categoryLabel).toBe("Food");
    expect(item.sectionId).toBe(mains._id);
  });

  test("an item cannot be filed under another vendor's section", async () => {
    const mine = await createUser();
    const theirs = await createUser();
    await newVendor(mine._id);
    await newVendor(theirs._id, { businessName: "Suya Spot" });

    const otherVendor = await vendorService.addSection({
      actorUserId: theirs._id,
      payload: { name: "Grills" },
    });

    await expect(
      newItem(mine._id, { sectionId: otherVendor.sections[0]._id }),
    ).rejects.toThrow(/does not exist on your menu/);
  });

  test("one vendor cannot touch another vendor's item", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    await newVendor(owner._id);
    await newVendor(stranger._id, { businessName: "Suya Spot" });

    const item = await newItem(owner._id);

    await expect(
      vendorService.updateItem({
        actorUserId: stranger._id,
        itemId: item._id,
        payload: { priceNaira: 1 },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(
      vendorService.deleteItem({ actorUserId: stranger._id, itemId: item._id }),
    ).rejects.toMatchObject({ statusCode: 404 });

    // And the item is untouched.
    const stored = await VendorItem.findById(item._id);
    expect(stored.priceNaira).toBe(4500);
  });

  test("deleting a section keeps its items, under the default heading", async () => {
    const user = await createUser();
    await newVendor(user._id);

    const withSection = await vendorService.addSection({
      actorUserId: user._id,
      payload: { name: "Mains" },
    });
    const mains = withSection.sections[0];
    const item = await newItem(user._id, { sectionId: mains._id });

    await vendorService.deleteSection({
      actorUserId: user._id,
      sectionId: mains._id,
    });

    const stored = await VendorItem.findById(item._id);
    expect(stored).not.toBeNull();
    expect(stored.sectionId).toBeNull();

    const menu = await vendorService.getMyMenu({ actorUserId: user._id });
    expect(menu.sections[0].name).toBe(vendorService.DEFAULT_SECTION_NAME);
    expect(menu.sections[0].items).toHaveLength(1);
  });

  test("two sections cannot share a name", async () => {
    const user = await createUser();
    await newVendor(user._id);

    await vendorService.addSection({
      actorUserId: user._id,
      payload: { name: "Mains" },
    });

    await expect(
      vendorService.addSection({
        actorUserId: user._id,
        payload: { name: "mains" },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test("sections keep the order the vendor put them in", async () => {
    const user = await createUser();
    await newVendor(user._id);

    for (const name of ["Mains", "Drinks", "Sides"]) {
      await vendorService.addSection({ actorUserId: user._id, payload: { name } });
    }

    const before = await vendorService.getMyVendor({ actorUserId: user._id });
    const ids = before.sections.map((section) => section._id);

    const after = await vendorService.reorderSections({
      actorUserId: user._id,
      sectionIds: [ids[2], ids[0], ids[1]],
    });

    expect(after.sections.map((section) => section.name)).toEqual([
      "Sides",
      "Mains",
      "Drinks",
    ]);
  });

  test("a partial reorder is refused rather than half-applied", async () => {
    const user = await createUser();
    await newVendor(user._id);

    for (const name of ["Mains", "Drinks"]) {
      await vendorService.addSection({ actorUserId: user._id, payload: { name } });
    }

    const vendor = await vendorService.getMyVendor({ actorUserId: user._id });

    await expect(
      vendorService.reorderSections({
        actorUserId: user._id,
        sectionIds: [vendor.sections[0]._id],
      }),
    ).rejects.toThrow(/every section id/);
  });

  test("a switched-off item disappears for buyers but not for the vendor", async () => {
    const user = await createUser();
    const vendor = await newVendor(user._id);

    await newItem(user._id);
    const soldOut = await newItem(user._id, { name: "Fried rice", priceNaira: 5500 });

    await vendorService.updateItem({
      actorUserId: user._id,
      itemId: soldOut._id,
      payload: { available: false },
    });

    const mine = await vendorService.getMyMenu({ actorUserId: user._id });
    expect(mine.itemCount).toBe(2);

    const publicMenu = await vendorService.getPublicVendorMenu({
      slug: vendor.slug,
    });
    expect(publicMenu.itemCount).toBe(1);
    expect(publicMenu.sections[0].items[0].name).toBe("Jollof rice & chicken");
  });

  test("a suspended vendor is not readable publicly, and cannot write", async () => {
    const user = await createUser();
    const vendor = await newVendor(user._id);

    await Vendor.updateOne(
      { _id: vendor._id },
      { $set: { status: "suspended" } },
    );

    await expect(
      vendorService.getPublicVendorMenu({ slug: vendor.slug }),
    ).rejects.toMatchObject({ statusCode: 404 });

    await expect(newItem(user._id)).rejects.toMatchObject({ statusCode: 403 });
  });

  test("a negative price is refused", async () => {
    const user = await createUser();
    await newVendor(user._id);

    await expect(newItem(user._id, { priceNaira: -100 })).rejects.toThrow(
      /cannot be negative/,
    );
  });

  test("the directory finds vendors by what they sell, and skips suspended ones", async () => {
    const food = await createUser();
    const drinks = await createUser();
    const hidden = await createUser();

    await newVendor(food._id, { categories: ["food"] });
    await newVendor(drinks._id, {
      businessName: "Chilled Bar Co.",
      categories: ["drinks"],
    });
    const suspended = await newVendor(hidden._id, {
      businessName: "Closed Kitchen",
      categories: ["food"],
    });
    await Vendor.updateOne(
      { _id: suspended._id },
      { $set: { status: "suspended" } },
    );

    const byCategory = await vendorService.listVendors({ category: "drinks" });
    expect(byCategory.items.map((item) => item.businessName)).toEqual([
      "Chilled Bar Co.",
    ]);

    const byName = await vendorService.listVendors({ search: "mama" });
    expect(byName.items).toHaveLength(1);

    const all = await vendorService.listVendors({});
    expect(all.items.map((item) => item.businessName)).not.toContain(
      "Closed Kitchen",
    );
  });
});
