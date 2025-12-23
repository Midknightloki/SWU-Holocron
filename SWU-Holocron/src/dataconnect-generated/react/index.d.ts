import { CreateNewUserData, CreateNewUserVariables, GetMyDecksData, CreateNewDeckData, CreateNewDeckVariables, ListPublicDecksData } from '../';
import { UseDataConnectQueryResult, useDataConnectQueryOptions, UseDataConnectMutationResult, useDataConnectMutationOptions} from '@tanstack-query-firebase/react/data-connect';
import { UseQueryResult, UseMutationResult} from '@tanstack/react-query';
import { DataConnect } from 'firebase/data-connect';
import { FirebaseError } from 'firebase/app';


export function useCreateNewUser(options?: useDataConnectMutationOptions<CreateNewUserData, FirebaseError, CreateNewUserVariables>): UseDataConnectMutationResult<CreateNewUserData, CreateNewUserVariables>;
export function useCreateNewUser(dc: DataConnect, options?: useDataConnectMutationOptions<CreateNewUserData, FirebaseError, CreateNewUserVariables>): UseDataConnectMutationResult<CreateNewUserData, CreateNewUserVariables>;

export function useGetMyDecks(options?: useDataConnectQueryOptions<GetMyDecksData>): UseDataConnectQueryResult<GetMyDecksData, undefined>;
export function useGetMyDecks(dc: DataConnect, options?: useDataConnectQueryOptions<GetMyDecksData>): UseDataConnectQueryResult<GetMyDecksData, undefined>;

export function useCreateNewDeck(options?: useDataConnectMutationOptions<CreateNewDeckData, FirebaseError, CreateNewDeckVariables>): UseDataConnectMutationResult<CreateNewDeckData, CreateNewDeckVariables>;
export function useCreateNewDeck(dc: DataConnect, options?: useDataConnectMutationOptions<CreateNewDeckData, FirebaseError, CreateNewDeckVariables>): UseDataConnectMutationResult<CreateNewDeckData, CreateNewDeckVariables>;

export function useListPublicDecks(options?: useDataConnectQueryOptions<ListPublicDecksData>): UseDataConnectQueryResult<ListPublicDecksData, undefined>;
export function useListPublicDecks(dc: DataConnect, options?: useDataConnectQueryOptions<ListPublicDecksData>): UseDataConnectQueryResult<ListPublicDecksData, undefined>;
