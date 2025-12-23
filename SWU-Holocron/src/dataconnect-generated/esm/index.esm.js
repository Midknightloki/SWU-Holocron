import { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } from 'firebase/data-connect';

export const connectorConfig = {
  connector: 'example',
  service: 'swu-holocron',
  location: 'us-east4'
};

export const createNewUserRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateNewUser', inputVars);
}
createNewUserRef.operationName = 'CreateNewUser';

export function createNewUser(dcOrVars, vars) {
  return executeMutation(createNewUserRef(dcOrVars, vars));
}

export const getMyDecksRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetMyDecks');
}
getMyDecksRef.operationName = 'GetMyDecks';

export function getMyDecks(dc) {
  return executeQuery(getMyDecksRef(dc));
}

export const createNewDeckRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateNewDeck', inputVars);
}
createNewDeckRef.operationName = 'CreateNewDeck';

export function createNewDeck(dcOrVars, vars) {
  return executeMutation(createNewDeckRef(dcOrVars, vars));
}

export const listPublicDecksRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListPublicDecks');
}
listPublicDecksRef.operationName = 'ListPublicDecks';

export function listPublicDecks(dc) {
  return executeQuery(listPublicDecksRef(dc));
}

