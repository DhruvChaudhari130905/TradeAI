export type AuthResponse =
  | { success: true; data: { userId: string; emailConfirmationNeeded?: boolean } }
  | { success: false; error: string };
