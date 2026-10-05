export const featureFlags = {
  scanner: true,
  intelligentOcr: true,
  localAi: true,
  wordEditor: true,
  spreadsheetEditor: true,
  presentationEditor: true,
  invoiceStudio: true,
  advancedSigning: true,
  dms: true,
  metadataStudio: true,
  automation: true,
  securityCenter: true,
  cad: true,
  dicom: true,
  enterpriseAdmin: true,
  backup: true,
  forensicWatermark: true,
  postQuantum: true,
} as const;

export type FeatureFlag = keyof typeof featureFlags;
