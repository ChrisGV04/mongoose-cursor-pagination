# Mongoose Cursor Pagination

A simple Mongoose plugin that allows defining cursor pagination for your Schemas.

This plugin is developed by [Christian Gil](https://cgvweb.com) mainly to be used on his own projects, since it provides common utilities used in many back-end projects.

## Installation

```bash
pnpm install @cgvweb/mongoose-cursor-pagination
```

> [!IMPORTANT]
> This package requires `mongoose ^7 || ^8` and `zod ^3` to be installed as peer dependencies.

## Usage

To use the cursor pagination functionality, you must install the plugin on your Schema and optionally add the type to the model:

```ts
// user.schema.ts
import { paginatePlugin, type PaginateFn } from '@cgvweb/mongoose-cursor-pagination';
import { Schema, model, type Model } from 'mongoose';

export interface UserFields {
  id: string;
  email: string;
  name: string;
}

/** Adds the `paginate` method type to the User model */
export interface UserModel extends Model<UserFields> {
  paginate: PaginateFn<UserFields>;
}

const userSchema = new Schema<UserFields>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
});

// Add the cursor pagination plugin
userSchema.plugin(paginatePlugin);

export const User = model<UserFields, UserModel>('user', userSchema);
```

Now you can use the `paginate` method on your schema to query the data using cursor pagination:

```ts
import { User } from './user.schema.ts';

async function searchUsers() {
  const result = await User.paginate({
    pagination: { limit: 10, order: 'asc' },
  });
  return result;
}
```

## Pagination Options

| Option                  | Type                | Required | Description                                                                                                                      |
| ----------------------- | ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pagination`            | `object`            | Yes      | The options for the paginated query.                                                                                             |
| `pagination.limit`      | `number`            | Yes      | The maximum number of docs to fetch per page.                                                                                    |
| `pagination.order`      | "asc" \| "desc"     | Yes      | The sorting order of the cursor.                                                                                                 |
| `pagination.prevCursor` | `string`            | No       | The cursor to fetch the previous page from.                                                                                      |
| `pagination.nextCursor` | `string`            | No       | The cursor to fetch the next page from. If used with `prevCursor` it will be ignored.                                            |
| `filters`               | `FilterQuery<T>`    | No       | Same filters you would pass to a regular Mongoose query.<br/><br/>For example: `{ filters: { status: "active" } }`               |
| `queryOpts`             | `QueryOptions<T>`   | No       | The same query options you would pass to a regular Mongoose query.<br/><br/>For example: `{ queryOpts: { populate: "author" } }` |
| `projection`            | `ProjectionType<T>` | No       | The same projection options you would pass to a regular Mongoose query.<br/><br/>For example: `{ projection: { email: false } }` |

## Pagination Response

| Field        | Type               | Description                                                                                                   |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `data`       | `T[]`              | The subset of documents on the current page based on the limit, order and cursors provided.                   |
| `totalCount` | `number`           | The total number of documents that match the query provided, including the ones on the current page.          |
| `nextCursor` | `string` \| `null` | The cursor you can use to fetch the next page of documents. If `null`, the current page is the last one.      |
| `prevCursor` | `string` \| `null` | The cursor you can use to fetch the previous page of documents. If `null`, the current page is the first one. |

## Additional Exports

To make sure you can use the pagination functions with data validation, this plugin also exports a few Zod schemas and types:

| Resource           | Type        | Description                                                                                                                                      |
| ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Paginated<T>`     | `type`      | The type of the response from the `paginate` method. The `T` generic is used to type the `data` array.                                           |
| `PaginateFn<T>`    | `type`      | The type used to add the `paginate` method to the Mongoose Schema. The `T` generic is used to add the document fields to the `paginate` options. |
| `PaginationSchema` | `ZodObject` | A Zod schema you can use to validate the options passed to `pagination`.                                                                         |
| `PaginationFields` | `type`      | The inferred type of `PaginationSchema`.                                                                                                         |
| `SortOrderType`    | `type`      | `asc` \| `desc`                                                                                                                                  |

## License

[MIT](./LICENSE) License © 2018-PRESENT [CGV WEB](https://github.com/ChrisGV04)
