import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function getPagination(input: PaginationInput): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  return {
    page: input.page,
    pageSize: input.pageSize,
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
  };
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number,
): { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } } {
  return {
    data,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}
