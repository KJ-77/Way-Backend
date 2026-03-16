import { executeQuery } from "../lib/db";
import type { User, CreateUserDto, UpdateUserDto } from "../lib/types";

export const getAllUsers = async (): Promise<User[]> =>
  executeQuery<User>("SELECT * FROM users ORDER BY id");

export const getUserById = async (id: number): Promise<User | null> => {
  const rows = await executeQuery<User>("SELECT * FROM users WHERE id = $1", [
    id,
  ]);
  return rows[0] ?? null;
};

export const createUser = async (data: CreateUserDto): Promise<User> => {
  const rows = await executeQuery<User>(
    `INSERT INTO users (
      full_name, gender, dob, level, preferred_tutor, loyalty,
      phone, email, first_visit, referral_source, status, section, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      data.full_name,
      data.gender,
      data.dob,
      data.level,
      data.preferred_tutor,
      data.loyalty,
      data.phone,
      data.email,
      data.first_visit,
      data.referral_source,
      data.status,
      data.section,
      data.notes,
    ],
  );
  return rows[0];
};

export const updateUser = async (
  id: number,
  data: UpdateUserDto,
): Promise<User | null> => {
  const fields = Object.keys(data);
  if (fields.length === 0) return getUserById(id);

  const setClauses = fields.map((key, i) => `${key} = $${i + 2}`);
  const values = fields.map((key) => data[key as keyof UpdateUserDto]);

  const rows = await executeQuery<User>(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $1 RETURNING *`,
    [id, ...values],
  );
  return rows[0] ?? null;
};

export const deleteUser = async (id: number): Promise<boolean> => {
  const rows = await executeQuery(
    "DELETE FROM users WHERE id = $1 RETURNING id",
    [id],
  );
  return rows.length > 0;
};
