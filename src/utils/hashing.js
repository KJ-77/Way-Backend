import bcrypt from "bcryptjs";
import { createHmac } from "crypto";
export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 12);
};

export const comparePasswords = async (plainPassword, hashedPassword) => {
  return await bcrypt.compare(plainPassword, hashedPassword);
};

export const hmacProcess = (value, key) => {
  const hmac = createHmac("sha256", key).update(value).digest("hex");
  return hmac;
};
