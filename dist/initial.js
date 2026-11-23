// Import private progress through the Data dialog.
const initial = { schemaVersion: 4, theme: "dark", active: null, missions: [] };
function migrateState(value) {
  if ((Number(value.schemaVersion) || 1) < 3) value.schemaVersion = 3;
  return value;
}
