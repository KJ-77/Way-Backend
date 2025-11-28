import slugify from "slugify";

const generateSlug = (text) => {
  return slugify(text, { lower: true, strict: true });
};

export default generateSlug;
