import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, MutationRef, MutationPromise } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface Card_Key {
  id: UUIDString;
  __typename?: 'Card_Key';
}

export interface CollectionCard_Key {
  userId: UUIDString;
  cardId: UUIDString;
  __typename?: 'CollectionCard_Key';
}

export interface CreateNewDeckData {
  deck_insert: Deck_Key;
}

export interface CreateNewDeckVariables {
  name: string;
  description: string;
  isPublic: boolean;
}

export interface CreateNewUserData {
  user_insert: User_Key;
}

export interface CreateNewUserVariables {
  displayName: string;
  email: string;
  username: string;
}

export interface DeckCard_Key {
  deckId: UUIDString;
  cardId: UUIDString;
  __typename?: 'DeckCard_Key';
}

export interface Deck_Key {
  id: UUIDString;
  __typename?: 'Deck_Key';
}

export interface Game_Key {
  id: UUIDString;
  __typename?: 'Game_Key';
}

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

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

interface CreateNewUserRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateNewUserVariables): MutationRef<CreateNewUserData, CreateNewUserVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateNewUserVariables): MutationRef<CreateNewUserData, CreateNewUserVariables>;
  operationName: string;
}
export const createNewUserRef: CreateNewUserRef;

export function createNewUser(vars: CreateNewUserVariables): MutationPromise<CreateNewUserData, CreateNewUserVariables>;
export function createNewUser(dc: DataConnect, vars: CreateNewUserVariables): MutationPromise<CreateNewUserData, CreateNewUserVariables>;

interface GetMyDecksRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetMyDecksData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<GetMyDecksData, undefined>;
  operationName: string;
}
export const getMyDecksRef: GetMyDecksRef;

export function getMyDecks(): QueryPromise<GetMyDecksData, undefined>;
export function getMyDecks(dc: DataConnect): QueryPromise<GetMyDecksData, undefined>;

interface CreateNewDeckRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateNewDeckVariables): MutationRef<CreateNewDeckData, CreateNewDeckVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateNewDeckVariables): MutationRef<CreateNewDeckData, CreateNewDeckVariables>;
  operationName: string;
}
export const createNewDeckRef: CreateNewDeckRef;

export function createNewDeck(vars: CreateNewDeckVariables): MutationPromise<CreateNewDeckData, CreateNewDeckVariables>;
export function createNewDeck(dc: DataConnect, vars: CreateNewDeckVariables): MutationPromise<CreateNewDeckData, CreateNewDeckVariables>;

interface ListPublicDecksRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListPublicDecksData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListPublicDecksData, undefined>;
  operationName: string;
}
export const listPublicDecksRef: ListPublicDecksRef;

export function listPublicDecks(): QueryPromise<ListPublicDecksData, undefined>;
export function listPublicDecks(dc: DataConnect): QueryPromise<ListPublicDecksData, undefined>;

