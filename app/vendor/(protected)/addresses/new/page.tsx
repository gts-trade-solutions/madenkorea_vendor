// app/vendor/(protected)/addresses/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { AddressForm, AddressFormValues } from "@/components/addresses/AddressForm";

const DEFAULT_VALUES: AddressFormValues = {
  label: "",
  name: "",
  phone: "",
  email: "",
  gstin: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  pincode: "",
  country: "India",
};

export default function NewAddressPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (v: AddressFormValues) => {
    setError(null);

    if (!v.label.trim()) return setError("Label is required.");
    if (!v.address_line1.trim()) return setError("Address line 1 is required.");
    if (!v.city.trim()) return setError("City is required.");
    if (!v.state.trim()) return setError("State is required.");
    if (!v.pincode.trim()) return setError("Pincode is required.");

    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in.");

      const { error } = await supabase.from("invoice_addresses").insert([
        {
          vendor_id: user.id,
          label: v.label.trim(),
          name: v.name || null,
          phone: v.phone || null,
          email: v.email || null,
          gstin: v.gstin || null,
          address_line1: v.address_line1.trim(),
          address_line2: v.address_line2 || null,
          city: v.city.trim(),
          state: v.state.trim(),
          pincode: v.pincode.trim(),
          country: (v.country || "India").trim(),
        },
      ]);

      if (error) throw new Error(error.message || "Failed to save address");

      router.push("/vendor/addresses");
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container mx-auto max-w-4xl py-6 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Add Address</CardTitle>
            <CardDescription>
              Save a reusable bill-to address for invoices.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => router.push("/vendor/addresses")}>
            ← Back
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <AddressForm
            initialValues={DEFAULT_VALUES}
            onSubmit={onSubmit}
            submitting={saving}
            submitText="Save Address"
          />
        </CardContent>
      </Card>
    </div>
  );
}
