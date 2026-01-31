import { createClient } from "@supabase/supabase-js";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from "./constants/index.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: undefined,
    persistSession: true,
    autoRefreshToken: true,
  },
});
// Create a separate Supabase client for backend operations
export const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY, // This bypasses RLS
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
