import { useState, useEffect, useCallback } from "react";
import {
  getOrCreateIdentity,
  updateDisplayName,
  regenerateIdentity,
  type UserIdentity,
} from "@/lib/crypto";

export function useIdentity() {
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIdentity = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const id = await getOrCreateIdentity();
      setIdentity(id);
    } catch (err) {
      setError("Failed to load identity");
      console.error("Identity error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  const setDisplayName = useCallback(async (name: string) => {
    try {
      await updateDisplayName(name);
      setIdentity((prev) => (prev ? { ...prev, displayName: name } : null));
    } catch (err) {
      console.error("Update display name error:", err);
    }
  }, []);

  const regenerate = useCallback(async () => {
    try {
      setLoading(true);
      const newIdentity = await regenerateIdentity();
      setIdentity(newIdentity);
    } catch (err) {
      console.error("Regenerate error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    identity,
    loading,
    error,
    setDisplayName,
    regenerate,
    refresh: loadIdentity,
  };
}
