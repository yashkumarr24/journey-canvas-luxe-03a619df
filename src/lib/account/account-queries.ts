/**
 * Private account data access (profile + travellers).
 *
 * Reads/writes go through the browser Supabase client and are therefore
 * executed AS THE SIGNED-IN USER — PostgreSQL RLS is the real authorization
 * boundary. The client-side `.eq("user_id", userId)` filters below are a
 * convenience, not the security control: even without them RLS returns only
 * the caller's rows.
 *
 * Booking data is NOT read here. Bookings belong to the FastAPI backend, which
 * derives ownership from the verified bearer token (see backend/app/core/auth.py).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { requireSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { privateKeys } from "@/lib/auth/query-keys";

export interface ProfileRow {
  id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface TravellerRow {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
}

export interface ProfileInput {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}

export interface TravellerInput {
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
}

/* ------------------------------- profile -------------------------------- */

export function useProfile(userId: string | null) {
  return useQuery({
    queryKey: privateKeys.profile(userId ?? "anonymous"),
    enabled: Boolean(userId) && isSupabaseConfigured,
    staleTime: 30_000,
    queryFn: async (): Promise<ProfileRow | null> => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("profiles")
        .select("id,user_id,first_name,last_name,email,phone")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as ProfileRow | null) ?? null;
    },
  });
}

export function useUpsertProfile(userId: string | null, email: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfileInput) => {
      const supabase = requireSupabase();
      // user_id always comes from the verified session, never from a form.
      const { error } = await supabase
        .from("profiles")
        .upsert({ user_id: userId!, email, ...input }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: privateKeys.profile(userId ?? "anonymous") });
    },
  });
}

/* ------------------------------ travellers ------------------------------ */

export function useTravellers(userId: string | null) {
  return useQuery({
    queryKey: privateKeys.travellers(userId ?? "anonymous"),
    enabled: Boolean(userId) && isSupabaseConfigured,
    staleTime: 30_000,
    queryFn: async (): Promise<TravellerRow[]> => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from("travellers")
        // Passport columns are intentionally NOT selected into the browser.
        .select("id,user_id,first_name,last_name,date_of_birth,gender,nationality")
        .eq("user_id", userId!)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data as TravellerRow[]) ?? [];
    },
  });
}

export function useAddTraveller(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TravellerInput) => {
      const supabase = requireSupabase();
      const { error } = await supabase.from("travellers").insert({ user_id: userId!, ...input });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: privateKeys.travellers(userId ?? "anonymous"),
      });
    },
  });
}
