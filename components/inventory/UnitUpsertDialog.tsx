"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  InventoryStatus,
  INVENTORY_STATUSES,
  statusLabel,
} from "@/components/inventory/UnitStatusBadge";
import { ScanBox } from "@/components/inventory/ScanBox";

type UnitRow = {
  id: string;
  unit_code: string;
  mfg_date: string | null;
  exp_date: string | null;
  status: InventoryStatus;
  created_at: string;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

function isValidCode(code: string) {
  return code.trim().length > 0;
}

export function UnitUpsertDialog({
  open,
  onOpenChange,
  mode,
  vendorId,
  productId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  vendorId: string;
  productId: string;
  initial?: UnitRow | null;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"manual" | "scan">("manual");

  const [unitCode, setUnitCode] = useState("");
  const [mfgDate, setMfgDate] = useState("");
  const [expDate, setExpDate] = useState("");
  const [status, setStatus] = useState<InventoryStatus>("IN_STOCK");
  const [busy, setBusy] = useState(false);

  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) return;

    if (isEdit && initial) {
      setTab("manual");
      setUnitCode(initial.unit_code ?? "");
      setMfgDate(initial.mfg_date ?? "");
      setExpDate(initial.exp_date ?? "");
      setStatus(initial.status ?? "IN_STOCK");
    } else {
      setTab("scan"); // default scanner mode is faster for warehouses
      setUnitCode("");
      setMfgDate("");
      setExpDate("");
      setStatus("IN_STOCK");
    }
  }, [open, isEdit, initial]);

  const canSave = useMemo(() => {
    if (!isValidCode(unitCode)) return false;
    if (mfgDate && expDate && mfgDate > expDate) return false;
    return true;
  }, [unitCode, mfgDate, expDate]);

  const ensureUniqueUnitCode = async (code: string) => {
    const trimmed = code.trim();

    const q = supabase
      .from("inventory_units")
      .select("id, unit_code")
      .eq("vendor_id", vendorId)
      .eq("unit_code", trimmed)
      .limit(1);

    const { data, error } = await q;
    if (error) throw error;

    // if creating, any row is conflict
    if (!isEdit) return (data?.length ?? 0) === 0;

    // if editing, conflict only if different id
    const found = data?.[0];
    if (!found) return true;
    if (initial?.id && found.id === initial.id) return true;
    return false;
  };

  const onScan = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    // Fill the unit_code from scan
    setUnitCode(trimmed);

    // Optional: quick check if already exists -> warn
    const { data, error } = await supabase
      .from("inventory_units")
      .select("id, unit_code")
      .eq("vendor_id", vendorId)
      .eq("unit_code", trimmed)
      .limit(1);

    if (error) {
      console.warn(error);
      return;
    }
    if (data && data.length > 0 && !isEdit) {
      toast.warning("This QR code already exists in inventory.");
    }
  };

  const save = async () => {
    const code = unitCode.trim();
    if (!isValidCode(code)) {
      toast.error("Unit code is required.");
      return;
    }
    if (mfgDate && expDate && mfgDate > expDate) {
      toast.error("MFG date cannot be after EXP date.");
      return;
    }

    setBusy(true);
    try {
      const ok = await ensureUniqueUnitCode(code);
      if (!ok) {
        toast.error("Unit code already exists. Use a different code.");
        setBusy(false);
        return;
      }

      if (!isEdit) {
        const { error } = await supabase.from("inventory_units").insert({
          vendor_id: vendorId,
          product_id: productId,
          unit_code: code,
          mfg_date: mfgDate || null,
          exp_date: expDate || null,
          status: "IN_STOCK",
        });

        if (error) throw error;
        toast.success("Unit added");
      } else {
        if (!initial?.id) throw new Error("Missing unit id to edit");

        const { error } = await supabase
          .from("inventory_units")
          .update({
            unit_code: code,
            mfg_date: mfgDate || null,
            exp_date: expDate || null,
            status,
          })
          .eq("id", initial.id)
          .eq("vendor_id", vendorId);

        if (error) throw error;
        toast.success("Unit updated");
      }

      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Failed to save unit");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit unit" : "Add unit"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update unit_code, dates, and status."
              : "Create a unit by scanning a QR (unit_code) or typing manually."}
          </DialogDescription>
        </DialogHeader>

        {!isEdit ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan">QR Scanner</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>

            <TabsContent value="scan" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Scan unit QR</Label>
                <ScanBox onScan={onScan} />
                <p className="text-xs text-muted-foreground">
                  Tip: QR should contain only the unit_code (example: MK-SS-00001)
                </p>
              </div>

              <div className="space-y-2">
                <Label>Unit code</Label>
                <Input
                  value={unitCode}
                  onChange={(e) => setUnitCode(e.target.value)}
                  placeholder="Scanned code appears here"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>MFG date</Label>
                  <Input
                    type="date"
                    value={mfgDate}
                    onChange={(e) => setMfgDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>EXP date</Label>
                  <Input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="manual" className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Unit code</Label>
                <Input
                  value={unitCode}
                  onChange={(e) => setUnitCode(e.target.value)}
                  placeholder="Enter unit_code (printed inside QR)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>MFG date</Label>
                  <Input
                    type="date"
                    value={mfgDate}
                    onChange={(e) => setMfgDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>EXP date</Label>
                  <Input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Unit code</Label>
              <Input
                value={unitCode}
                onChange={(e) => setUnitCode(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>MFG date</Label>
                <Input
                  type="date"
                  value={mfgDate}
                  onChange={(e) => setMfgDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>EXP date</Label>
                <Input
                  type="date"
                  value={expDate}
                  onChange={(e) => setExpDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as any)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {INVENTORY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave || busy} onClick={save}>
            {busy ? "Saving..." : isEdit ? "Save changes" : "Add unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
