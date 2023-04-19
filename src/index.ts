import { Schema, type FilterQuery, type Model, type ProjectionType, type QueryOptions } from 'mongoose';
import { z } from 'zod';
import { deepMerge } from './deep-merge';

export interface Paginated<T = any> {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
}

const SortOrderEnum = z.enum(['asc', 'desc']);
export type SortOrderType = z.infer<typeof SortOrderEnum>;

export const PaginationSchema = z.object({
  nextCursor: z.string().optional(),
  prevCursor: z.string().optional(),
  order: SortOrderEnum.default('desc'),
  limit: z.number({ coerce: true }).int().min(1).max(50).default(10),
});
export type PaginationFields = z.infer<typeof PaginationSchema>;

interface SortOrderResult {
  sortOrder: -1 | 1;
  key: '$gt' | '$lt';
  query: SortOrderType;
  prevKey: '$gt' | '$lt';
  nextKey: '$gt' | '$lt';
}

interface PaginateOpts<T> {
  pagination: PaginationFields;
  filters?: FilterQuery<T>;
  queryOpts?: QueryOptions<T> | null | undefined;
  projection?: ProjectionType<T> | null | undefined;
}

type PaginationResult<T = any> = Paginated<ReturnType<Model<T>['hydrate']>>;
export type PaginateFn<T = any> = (this: Model<T>, opts: PaginateOpts<T>) => Promise<PaginationResult<T>>;

async function paginate<T = any>(this: Model<T>, opts: PaginateOpts<T>): Promise<PaginationResult<T>> {
  const query = _getQuery(opts.pagination, opts.filters);

  const docs = await this.find(query.filter, opts.projection, {
    ...opts.queryOpts,
    sort: query.sort,
    limit: query.limit,
  });
  if (query.reverse) docs.reverse();

  let hasNext = false;
  let hasPrev = false;

  if (docs.length) {
    hasNext = !!(await this.count({ ...opts.filters, _id: { [query.order.nextKey]: docs.at(-1)?.id } }));
    hasPrev = !!(await this.count({ ...opts.filters, _id: { [query.order.prevKey]: docs.at(0)?.id } }));
  }

  return {
    data: docs,
    nextCursor: hasNext ? docs.at(-1)?.id : null,
    prevCursor: hasPrev ? docs.at(0)?.id : null,
  };
}

export function paginatePlugin<T>(schema: Schema<T>) {
  schema.statics.paginate = paginate;
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
function _getQuery(query: PaginationFields, mergeFilters?: FilterQuery<any>) {
  const _filter: any = {};
  const order: SortOrderResult = {
    query: query.order,
    sortOrder: query.order === 'desc' ? -1 : 1,
    key: query.order === 'desc' ? '$gt' : '$lt',
    prevKey: query.order === 'desc' ? '$gt' : '$lt',
    nextKey: query.order === 'desc' ? '$lt' : '$gt',
  };

  let cursor = '';
  let reverse = false;

  // TODO: Maybe add functionality to sort by more than one field

  if (query.prevCursor) {
    reverse = true;
    cursor = query.prevCursor;

    if (order.query === 'desc') {
      order.key = '$gt';
      order.sortOrder = 1;
    } else {
      order.key = '$lt';
      order.sortOrder = -1;
    }
  } else if (query.nextCursor) {
    cursor = query.nextCursor;

    if (order.query === 'desc') {
      order.key = '$lt';
      order.sortOrder = -1;
    } else {
      order.key = '$gt';
      order.sortOrder = 1;
    }
  }

  const sort = { _id: order.sortOrder };

  if (cursor) {
    _filter._id = { [order.key]: cursor };
  }

  const filter = deepMerge(_filter, mergeFilters);

  return { filter, sort, order, reverse, limit: query.limit };
}
