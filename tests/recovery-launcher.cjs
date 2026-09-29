// Test-only entry point. Native dialog responses are deterministic; production main is unchanged.
const { dialog } = require("electron");
dialog.showMessageBox = async () => ({
  response: Number(process.env.AXON_TEST_CHOICE || 0),
  checkboxChecked: false,
});
require("../dist-electron/main.cjs");
