import type { FilterQuery, Model, ProjectionType, QueryOptions, Schema, Types } from 'mongoose';

import { z } from 'zod';

/** Shape of the result of the pagination query */
export interface Paginated<T = any> {
  data: T[];
  totalCount: number;
  nextCursor: string | null;
  prevCursor: string | null;
}

export const SortOrderEnum = z.enum(['asc', 'desc']);
export type SortOrderType = z.infer<typeof SortOrderEnum>;

const HEX_REGEX = /^(0x|0h)?[0-9A-F]+$/i;

export function isObjectId(value: unknown) {
  const asString = z.string().safeParse(value);
  if (!asString.success) return false;

  const isHex = HEX_REGEX.test(asString.data);
  return isHex && asString.data.length === 24;
}

/**
 * Zod validator to check if a string is a valid ObjectId for MongoDB
 */
export const MongoIdSchema = z
  .string()
  .min(24)
  .refine((val) => isObjectId(val), 'ID inválida');

/** Schema that decodes a string cursor and validates the cursor shape */
const CursorSchema = z
  .string()
  .base64('Cursor inválido')
  .transform((v) => JSON.parse(Buffer.from(v, 'base64').toString('utf8')))
  .pipe(
    z.object({
      id: MongoIdSchema,
      v: z.string({ coerce: true }).optional(),
    }),
  );

/** The shape every cursor must have after being decoded from Base64 */
type DecodedCursor = z.infer<typeof CursorSchema>;

/** Schema to validate the query fields required for cursor pagination  */
export const PaginationSchema = z.object({
  /** Base64 encoded cursor for the last item in the previous page. Used to get the next set of items */
  nextCursor: z.string().optional(),
  /** Base64 encoded cursor for the first item in the current page. Used to get the previous set of items */
  prevCursor: z.string().optional(),
  /** Sorting order to be used. @default "desc" */
  order: SortOrderEnum.default('desc'),
  /** Max number of items per page. @default 10 */
  limit: z.number({ coerce: true }).int().min(1).max(50).default(10),
  /**
   * Field to use for sorting.
   *
   * **IMPORTANT:** When using a non-id field, create a compund index for both `_id` and each field that allows sorting.
   *
   * @example schema.createIndex({ _id: 1, createdAt: 1 }) // Compound index to allow sorting by createdAt
   *
   * @default "_id"
   */
  sortBy: z.string().default('_id'),
});
export type PaginationFields = z.infer<typeof PaginationSchema>;

interface QueryOrderResult {
  /**
   * The sort order and query operator for the current search query.
   *
   * First item is the required sorting direction. Second item is the filter operator key
   */
  current: [-1 | 1, '$gt' | '$lt'];
  /**
   * The sort order and query operator to get the next items from the current cursor.
   *
   * First item is the required sorting direction. Second item is the filter operator key
   */
  next: [-1 | 1, '$gt' | '$lt'];
  /**
   * The sort order and query operator to get the previous items from the current cursor.
   *
   * First item is the required sorting direction. Second item is the filter operator key
   */
  prev: [-1 | 1, '$gt' | '$lt'];
}

/** The shape of the function to parse a sort value */
type ParseSortValueFn = (value: string) => string | number | Date | Types.ObjectId | undefined;

/** The available options to configure the pagination query */
interface PaginateOpts<T> {
  /** Pagination fields */
  pagination: PaginationFields;
  /** Additional query filters to narrow down the search */
  filters?: FilterQuery<T>;
  /** Additional query options for the `Model.find` method */
  queryOpts?: QueryOptions<T> | null | undefined;
  /** Define projection for the `Model.find` method */
  projection?: ProjectionType<T> | null | undefined;
  /**
   * Function that parses the sort value into the required format to accurately perform the DB query.
   *
   * For example: If you want to sort by an `ISODate` field called `createdAt`, the cursor will include the value as a string,
   * but we need it to be a `Date` for `{ createdAt: { $gt: value } }` to work properly.
   *
   * @example (value) => new Date(value) // Convert string into date
   * @example (value) => Number(value) // Convert string into number
   * @example ```
   * import { Types } from "mongoose";
   *
   * (value) => new Types.ObjectId(value) // Convert string into MongoDB ObjectID
   * ```
   */
  parseSortValue?: ParseSortValueFn;
}

/** The shape of the result from the pagination query */
type PaginationResult<T = any> = Paginated<ReturnType<Model<T>['hydrate']>>;
/** Shape of the method that gets added to the Model to perform a cursor paginated query */
export type PaginateFn<T = any> = (this: Model<T>, opts: PaginateOpts<T>) => Promise<PaginationResult<T>>;

/** The core functionality to perform cursor paginated queries */
async function paginate<T = any>(this: Model<T>, opts: PaginateOpts<T>): Promise<PaginationResult<T>> {
  const query = _getQuery(opts.pagination, opts.parseSortValue, opts.filters);

  const docs = await this.find(query.filter, opts.projection, {
    ...opts.queryOpts,
    sort: query.sort,
    limit: query.limit,
  });
  if (query.reverse) docs.reverse();

  let nextCursor: DecodedCursor | null = null;
  let prevCursor: DecodedCursor | null = null;
  let totalCount = docs.length;

  if (docs.length) {
    //////////////////////////////////////////////////////
    // Check if there are more items after the last one //
    //////////////////////////////////////////////////////

    nextCursor =
      docs.length === opts.pagination.limit
        ? {
            id: docs.at(-1)?.id,
            v:
              opts.pagination.sortBy !== '_id'
                ? // @ts-expect-error: Seems like type infer is complaining
                  stringifySortValue(docs.at(-1)?.[opts.pagination.sortBy])
                : undefined,
          }
        : null;

    if (nextCursor) {
      const [nextFilter] = getFiltersFromCursor(
        nextCursor,
        query.order.next,
        { by: opts.pagination.sortBy, parse: opts.parseSortValue },
        opts.filters,
      );

      const nextCount = await this.countDocuments(nextFilter);

      // No more items found. No need for a next cursor
      if (!nextCount) nextCursor = null;

      totalCount += nextCount;
    }

    ////////////////////////////////////////////////////////
    // Check if there are more items before the first one //
    ////////////////////////////////////////////////////////

    prevCursor = {
      id: docs.at(0)?.id,
      v:
        opts.pagination.sortBy !== '_id'
          ? // @ts-expect-error: Seems like type infer is complaining
            stringifySortValue(docs.at(0)?.[opts.pagination.sortBy])
          : undefined,
    };

    // Previous requires the opposite order fn
    const [prevFilter] = getFiltersFromCursor(
      prevCursor,
      query.order.prev,
      { by: opts.pagination.sortBy, parse: opts.parseSortValue },
      opts.filters,
    );

    const prevCount = await this.countDocuments(prevFilter);

    // No previous items found. No need for a previous cursor
    if (!prevCount) prevCursor = null;

    totalCount += prevCount;
  }

  return {
    data: docs,
    totalCount,
    nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
    prevCursor: prevCursor ? encodeCursor(prevCursor) : null,
  };
}

/**
 * Helper to implement cursor-based pagination for MongoDB.
 * It generates the required filters and sorting options to perform a search
 * by using either a nextCursor or prevCursor.
 *
 * You can merge your own filters as a second parameter. However, those filters
 * must only be exclusive, since we haven't implemented multi-fields for sorting
 * and using as cursors.
 */
function _getQuery(query: PaginationFields, parse?: ParseSortValueFn, baseFilters?: FilterQuery<any>) {
  const order: QueryOrderResult = {
    current: query.order === 'desc' ? [-1, '$gt'] : [1, '$lt'],
    next: query.order === 'desc' ? [1, '$lt'] : [-1, '$gt'],
    prev: query.order === 'desc' ? [-1, '$gt'] : [1, '$lt'],
  };

  let cursor: DecodedCursor | null = null;
  let reverse = false;

  if (query.prevCursor) {
    reverse = true;
    cursor = decodeCursor(query.prevCursor);
    order.current = query.order === 'desc' ? [1, '$gt'] : [-1, '$lt'];
  } else if (query.nextCursor) {
    cursor = decodeCursor(query.nextCursor);
    order.current = query.order === 'desc' ? [-1, '$lt'] : [1, '$gt'];
  }

  const [filter, sort] = getFiltersFromCursor(
    cursor,
    order.current,
    { by: query.sortBy, parse },
    baseFilters,
  );

  return { filter, cursor, sort, order, reverse, limit: query.limit };
}

/** Simple utility to encode a cursor as Base64 */
function encodeCursor(cursor: DecodedCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

/** Simple utility to decode a cursor from Base64. Returns `null` if value is not a valid cursor */
function decodeCursor(encoded: string): DecodedCursor | null {
  const result = CursorSchema.safeParse(encoded);
  if (!result.success) return null;
  return result.data;
}

/** Converts a sort value into a string representation of it */
function stringifySortValue(value?: ReturnType<ParseSortValueFn>) {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Generates the required query to get cursor paginated results with sorting */
function getFiltersFromCursor(
  cursor: DecodedCursor | null,
  order: QueryOrderResult['current'],
  sort: { by: string; parse?: ParseSortValueFn },
  baseFilters?: FilterQuery<any>,
): [FilterQuery<any>, Record<string, 1 | -1>] {
  const filter: FilterQuery<any> = {};

  const sortRules: Record<string, 1 | -1> =
    sort.by === '_id' ? { _id: order[0] } : { [sort.by]: order[0], _id: order[0] };

  if (!cursor) return [baseFilters ? { $and: [filter, baseFilters] } : filter, sortRules];

  if (cursor.v !== undefined) {
    // The sorting will be done at another field
    const parsedSortValue = sort.parse ? sort.parse(cursor.v) : cursor.v;

    filter.$or = [
      { [sort.by]: { [order[1]]: parsedSortValue } },
      {
        [sort.by]: parsedSortValue,
        _id: { [order[1]]: cursor.id },
      },
    ];
  } else {
    // No extra sorting field. Only sort by _id
    filter._id = { [order[1]]: cursor.id };
  }

  return [baseFilters ? { $and: [filter, baseFilters] } : filter, sortRules];
}

/** Mongoose plugin to add cursor pagination to any Schema */
export function paginatePlugin<T>(schema: Schema<T>) {
  schema.statics.paginate = paginate;
}
