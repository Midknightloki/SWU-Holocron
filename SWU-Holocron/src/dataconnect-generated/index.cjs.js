const { queryRef, executeQuery, mutationRef, executeMutation, validateArgs } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'example',
  service: 'swu-holocron',
  location: 'us-east4'
};
exports.connectorConfig = connectorConfig;

const createNewUserRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateNewUser', inputVars);
}
createNewUserRef.operationName = 'CreateNewUser';
exports.createNewUserRef = createNewUserRef;

exports.createNewUser = function createNewUser(dcOrVars, vars) {
  return executeMutation(createNewUserRef(dcOrVars, vars));
};

const getMyDecksRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetMyDecks');
}
getMyDecksRef.operationName = 'GetMyDecks';
exports.getMyDecksRef = getMyDecksRef;

exports.getMyDecks = function getMyDecks(dc) {
  return executeQuery(getMyDecksRef(dc));
};

const createNewDeckRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateNewDeck', inputVars);
}
createNewDeckRef.operationName = 'CreateNewDeck';
exports.createNewDeckRef = createNewDeckRef;

exports.createNewDeck = function createNewDeck(dcOrVars, vars) {
  return executeMutation(createNewDeckRef(dcOrVars, vars));
};

const listPublicDecksRef = (dc) => {
  const { dc: dcInstance} = validateArgs(connectorConfig, dc, undefined);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListPublicDecks');
}
listPublicDecksRef.operationName = 'ListPublicDecks';
exports.listPublicDecksRef = listPublicDecksRef;

exports.listPublicDecks = function listPublicDecks(dc) {
  return executeQuery(listPublicDecksRef(dc));
};
