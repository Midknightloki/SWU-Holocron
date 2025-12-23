import { ConnectorConfig, DataConnect, OperationOptions, ExecuteOperationResponse } from 'firebase-admin/data-connect';

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

/** Generated Node Admin SDK operation action function for the 'CreateNewUser' Mutation. Allow users to execute without passing in DataConnect. */
export function createNewUser(dc: DataConnect, vars: CreateNewUserVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateNewUserData>>;
/** Generated Node Admin SDK operation action function for the 'CreateNewUser' Mutation. Allow users to pass in custom DataConnect instances. */
export function createNewUser(vars: CreateNewUserVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateNewUserData>>;

/** Generated Node Admin SDK operation action function for the 'GetMyDecks' Query. Allow users to execute without passing in DataConnect. */
export function getMyDecks(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<GetMyDecksData>>;
/** Generated Node Admin SDK operation action function for the 'GetMyDecks' Query. Allow users to pass in custom DataConnect instances. */
export function getMyDecks(options?: OperationOptions): Promise<ExecuteOperationResponse<GetMyDecksData>>;

/** Generated Node Admin SDK operation action function for the 'CreateNewDeck' Mutation. Allow users to execute without passing in DataConnect. */
export function createNewDeck(dc: DataConnect, vars: CreateNewDeckVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateNewDeckData>>;
/** Generated Node Admin SDK operation action function for the 'CreateNewDeck' Mutation. Allow users to pass in custom DataConnect instances. */
export function createNewDeck(vars: CreateNewDeckVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<CreateNewDeckData>>;

/** Generated Node Admin SDK operation action function for the 'ListPublicDecks' Query. Allow users to execute without passing in DataConnect. */
export function listPublicDecks(dc: DataConnect, options?: OperationOptions): Promise<ExecuteOperationResponse<ListPublicDecksData>>;
/** Generated Node Admin SDK operation action function for the 'ListPublicDecks' Query. Allow users to pass in custom DataConnect instances. */
export function listPublicDecks(options?: OperationOptions): Promise<ExecuteOperationResponse<ListPublicDecksData>>;

