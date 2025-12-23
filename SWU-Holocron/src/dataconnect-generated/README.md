# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `example`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

**If you're looking for the `React README`, you can find it at [`dataconnect-generated/react/README.md`](./react/README.md)**

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*GetMyDecks*](#getmydecks)
  - [*ListPublicDecks*](#listpublicdecks)
- [**Mutations**](#mutations)
  - [*CreateNewUser*](#createnewuser)
  - [*CreateNewDeck*](#createnewdeck)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `example`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@dataconnect/generated` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@dataconnect/generated';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## GetMyDecks
You can execute the `GetMyDecks` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getMyDecks(): QueryPromise<GetMyDecksData, undefined>;

interface GetMyDecksRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetMyDecksData, undefined>;
}
export const getMyDecksRef: GetMyDecksRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getMyDecks(dc: DataConnect): QueryPromise<GetMyDecksData, undefined>;

interface GetMyDecksRef {
  ...
  (dc: DataConnect): QueryRef<GetMyDecksData, undefined>;
}
export const getMyDecksRef: GetMyDecksRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getMyDecksRef:
```typescript
const name = getMyDecksRef.operationName;
console.log(name);
```

### Variables
The `GetMyDecks` query has no variables.
### Return Type
Recall that executing the `GetMyDecks` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetMyDecksData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface GetMyDecksData {
  decks: ({
    id: UUIDString;
    name: string;
    description?: string | null;
    isPublic: boolean;
    createdAt: TimestampString;
    updatedAt: TimestampString;
  } & Deck_Key)[];
}
```
### Using `GetMyDecks`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getMyDecks } from '@dataconnect/generated';


// Call the `getMyDecks()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getMyDecks();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getMyDecks(dataConnect);

console.log(data.decks);

// Or, you can use the `Promise` API.
getMyDecks().then((response) => {
  const data = response.data;
  console.log(data.decks);
});
```

### Using `GetMyDecks`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getMyDecksRef } from '@dataconnect/generated';


// Call the `getMyDecksRef()` function to get a reference to the query.
const ref = getMyDecksRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getMyDecksRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.decks);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.decks);
});
```

## ListPublicDecks
You can execute the `ListPublicDecks` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
listPublicDecks(): QueryPromise<ListPublicDecksData, undefined>;

interface ListPublicDecksRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListPublicDecksData, undefined>;
}
export const listPublicDecksRef: ListPublicDecksRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listPublicDecks(dc: DataConnect): QueryPromise<ListPublicDecksData, undefined>;

interface ListPublicDecksRef {
  ...
  (dc: DataConnect): QueryRef<ListPublicDecksData, undefined>;
}
export const listPublicDecksRef: ListPublicDecksRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listPublicDecksRef:
```typescript
const name = listPublicDecksRef.operationName;
console.log(name);
```

### Variables
The `ListPublicDecks` query has no variables.
### Return Type
Recall that executing the `ListPublicDecks` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListPublicDecksData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface ListPublicDecksData {
  decks: ({
    id: UUIDString;
    name: string;
    description?: string | null;
    createdAt: TimestampString;
    updatedAt: TimestampString;
    user: {
      id: UUIDString;
      username: string;
    } & User_Key;
  } & Deck_Key)[];
}
```
### Using `ListPublicDecks`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listPublicDecks } from '@dataconnect/generated';


// Call the `listPublicDecks()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listPublicDecks();

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listPublicDecks(dataConnect);

console.log(data.decks);

// Or, you can use the `Promise` API.
listPublicDecks().then((response) => {
  const data = response.data;
  console.log(data.decks);
});
```

### Using `ListPublicDecks`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listPublicDecksRef } from '@dataconnect/generated';


// Call the `listPublicDecksRef()` function to get a reference to the query.
const ref = listPublicDecksRef();

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listPublicDecksRef(dataConnect);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.decks);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.decks);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `example` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## CreateNewUser
You can execute the `CreateNewUser` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createNewUser(vars: CreateNewUserVariables): MutationPromise<CreateNewUserData, CreateNewUserVariables>;

interface CreateNewUserRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateNewUserVariables): MutationRef<CreateNewUserData, CreateNewUserVariables>;
}
export const createNewUserRef: CreateNewUserRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createNewUser(dc: DataConnect, vars: CreateNewUserVariables): MutationPromise<CreateNewUserData, CreateNewUserVariables>;

interface CreateNewUserRef {
  ...
  (dc: DataConnect, vars: CreateNewUserVariables): MutationRef<CreateNewUserData, CreateNewUserVariables>;
}
export const createNewUserRef: CreateNewUserRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createNewUserRef:
```typescript
const name = createNewUserRef.operationName;
console.log(name);
```

### Variables
The `CreateNewUser` mutation requires an argument of type `CreateNewUserVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateNewUserVariables {
  displayName: string;
  email: string;
  username: string;
}
```
### Return Type
Recall that executing the `CreateNewUser` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateNewUserData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateNewUserData {
  user_insert: User_Key;
}
```
### Using `CreateNewUser`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createNewUser, CreateNewUserVariables } from '@dataconnect/generated';

// The `CreateNewUser` mutation requires an argument of type `CreateNewUserVariables`:
const createNewUserVars: CreateNewUserVariables = {
  displayName: ..., 
  email: ..., 
  username: ..., 
};

// Call the `createNewUser()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createNewUser(createNewUserVars);
// Variables can be defined inline as well.
const { data } = await createNewUser({ displayName: ..., email: ..., username: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createNewUser(dataConnect, createNewUserVars);

console.log(data.user_insert);

// Or, you can use the `Promise` API.
createNewUser(createNewUserVars).then((response) => {
  const data = response.data;
  console.log(data.user_insert);
});
```

### Using `CreateNewUser`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createNewUserRef, CreateNewUserVariables } from '@dataconnect/generated';

// The `CreateNewUser` mutation requires an argument of type `CreateNewUserVariables`:
const createNewUserVars: CreateNewUserVariables = {
  displayName: ..., 
  email: ..., 
  username: ..., 
};

// Call the `createNewUserRef()` function to get a reference to the mutation.
const ref = createNewUserRef(createNewUserVars);
// Variables can be defined inline as well.
const ref = createNewUserRef({ displayName: ..., email: ..., username: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createNewUserRef(dataConnect, createNewUserVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.user_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.user_insert);
});
```

## CreateNewDeck
You can execute the `CreateNewDeck` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createNewDeck(vars: CreateNewDeckVariables): MutationPromise<CreateNewDeckData, CreateNewDeckVariables>;

interface CreateNewDeckRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateNewDeckVariables): MutationRef<CreateNewDeckData, CreateNewDeckVariables>;
}
export const createNewDeckRef: CreateNewDeckRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createNewDeck(dc: DataConnect, vars: CreateNewDeckVariables): MutationPromise<CreateNewDeckData, CreateNewDeckVariables>;

interface CreateNewDeckRef {
  ...
  (dc: DataConnect, vars: CreateNewDeckVariables): MutationRef<CreateNewDeckData, CreateNewDeckVariables>;
}
export const createNewDeckRef: CreateNewDeckRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createNewDeckRef:
```typescript
const name = createNewDeckRef.operationName;
console.log(name);
```

### Variables
The `CreateNewDeck` mutation requires an argument of type `CreateNewDeckVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateNewDeckVariables {
  name: string;
  description: string;
  isPublic: boolean;
}
```
### Return Type
Recall that executing the `CreateNewDeck` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateNewDeckData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateNewDeckData {
  deck_insert: Deck_Key;
}
```
### Using `CreateNewDeck`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createNewDeck, CreateNewDeckVariables } from '@dataconnect/generated';

// The `CreateNewDeck` mutation requires an argument of type `CreateNewDeckVariables`:
const createNewDeckVars: CreateNewDeckVariables = {
  name: ..., 
  description: ..., 
  isPublic: ..., 
};

// Call the `createNewDeck()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createNewDeck(createNewDeckVars);
// Variables can be defined inline as well.
const { data } = await createNewDeck({ name: ..., description: ..., isPublic: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createNewDeck(dataConnect, createNewDeckVars);

console.log(data.deck_insert);

// Or, you can use the `Promise` API.
createNewDeck(createNewDeckVars).then((response) => {
  const data = response.data;
  console.log(data.deck_insert);
});
```

### Using `CreateNewDeck`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createNewDeckRef, CreateNewDeckVariables } from '@dataconnect/generated';

// The `CreateNewDeck` mutation requires an argument of type `CreateNewDeckVariables`:
const createNewDeckVars: CreateNewDeckVariables = {
  name: ..., 
  description: ..., 
  isPublic: ..., 
};

// Call the `createNewDeckRef()` function to get a reference to the mutation.
const ref = createNewDeckRef(createNewDeckVars);
// Variables can be defined inline as well.
const ref = createNewDeckRef({ name: ..., description: ..., isPublic: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createNewDeckRef(dataConnect, createNewDeckVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.deck_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.deck_insert);
});
```

