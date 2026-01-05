"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type InventoryStatus = "IN_STOCK" | "INVOICED" | "SOLD" | "OUT_OF_STOCK";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

function toYmd(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10); // YYYY-MM-DD
}

function addYears(date: Date, years: number) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function pad3(n: number) {
  return String(n).padStart(3, "0");
}

function ymdToCompact(ymd: string) {
  return (ymd || "").replaceAll("-", ""); // YYYYMMDD
}

function priceToCodePart(price: number) {
  // avoid dot in unit code; convert to paise-like integer (2 decimals)
  if (!Number.isFinite(price)) return "";
  return String(Math.round(price * 100));
}

function first2Letters(name: string) {
  const letters = (name || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return (letters.slice(0, 2) || "XX").padEnd(2, "X");
}

function rand4() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
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
  initial?: {
    id: string;
    unit_code: string;
    manufacture_date?: string | null;
    expiry_date?: string | null;
    status: InventoryStatus;
    price?: number | null;
  } | null;
  onSaved: () => void;
}) {
  const isEdit = mode === "edit";
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [saving, setSaving] = useState(false);

  // auto fetched
  const [productName, setProductName] = useState("");
  const [brandName, setBrandName] = useState("");

  const [productCode, setProductCode] = useState("");
  const [brandCode, setBrandCode] = useState("");

  const [manufactureDate, setManufactureDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [price, setPrice] = useState<number>(0);

  // batch count
  const [unitsCount, setUnitsCount] = useState<number>(1);

  // edit fields
  const [editStatus, setEditStatus] = useState<InventoryStatus>("IN_STOCK");

  // Load on open
  useEffect(() => {
    if (!open) return;

    // EDIT MODE: no regeneration; allow update of status/dates/price
    if (isEdit && initial) {
      setManufactureDate((initial.manufacture_date ?? "") as string);
      setExpiryDate((initial.expiry_date ?? "") as string);
      setPrice(Number(initial.price ?? 0));
      setEditStatus(initial.status);
      setUnitsCount(1);
      return;
    }

    // CREATE MODE: auto fill everything
    (async () => {
      setLoadingMeta(true);
      try {
        const today = new Date();
        setManufactureDate(toYmd(addYears(today, -1)));
        setExpiryDate(toYmd(addYears(today, 2)));
        setUnitsCount(1);

        // get product (need product_code + price + brand_id + name)
        const { data: p, error: pErr } = await supabase
          .from("products")
          .select("id,name,product_code,price,sale_price,brand_id")
          .eq("id", productId)
          .single();

        if (pErr) throw pErr;

        const pName = (p as any)?.name ?? "";
        setProductName(pName);

        // if product_code missing, fallback to generated (for UI only)
        const pCode =
          (p as any)?.product_code?.toString()?.trim() ||
          `${first2Letters(pName)}${rand4()}`;
        setProductCode(pCode);

        const pPrice =
          (p as any)?.sale_price != null
            ? Number((p as any).sale_price)
            : Number((p as any)?.price ?? 0);
        setPrice(Number.isFinite(pPrice) ? pPrice : 0);

        // brand fetch for brand_code
        const brandId = (p as any)?.brand_id;
        if (brandId) {
          const { data: b, error: bErr } = await supabase
            .from("brands")
            .select("id,name,brand_code")
            .eq("id", brandId)
            .single();

          if (bErr) throw bErr;

          const bName = (b as any)?.name ?? "";
          setBrandName(bName);

          const bCode =
            (b as any)?.brand_code?.toString()?.trim() ||
            `${first2Letters(bName)}${rand4()}`;
          setBrandCode(bCode);
        } else {
          // brand not linked
          setBrandName("");
          setBrandCode("XX" + rand4());
        }
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || "Failed to load product/brand data");
      } finally {
        setLoadingMeta(false);
      }
    })();
  }, [open, isEdit, initial, productId]);

  // base (batch) code = product_code&brand_code&mfg&exp&price
  const batchBaseCode = useMemo(() => {
    if (!productCode || !brandCode || !manufactureDate || !expiryDate) return "";
    const mfg = ymdToCompact(manufactureDate);
    const exp = ymdToCompact(expiryDate);
    const pr = priceToCodePart(price);
    return `${productCode}${brandCode}${mfg}${exp}${pr}`;
  }, [productCode, brandCode, manufactureDate, expiryDate, price]);

  const previewCodes = useMemo(() => {
    if (!batchBaseCode) return [];
    const n = Math.min(Math.max(Math.floor(unitsCount || 1), 1), 3);
    return Array.from({ length: n }).map((_, i) => `${batchBaseCode}-${pad3(i + 1)}`);
  }, [batchBaseCode, unitsCount]);

  const createBatch = async () => {
    if (!vendorId || !productId) return;

    const count = Math.max(1, Math.floor(unitsCount || 1));

    if (!batchBaseCode) {
      toast.error("Unit code not ready. Please check dates/codes.");
      return;
    }
    if (!manufactureDate) {
      toast.error("Manufacture date is required.");
      return;
    }
    if (!expiryDate) {
      toast.error("Expiry date is required.");
      return;
    }

    setSaving(true);
    try {
      // IMPORTANT: match your DB column names
      const rows = Array.from({ length: count }).map((_, i) => ({
        vendor_id: vendorId,
        product_id: productId,
        unit_code: `${batchBaseCode}-${pad3(i + 1)}`,
        manufacture_date: manufactureDate, // NOT NULL in your DB
        expiry_date: expiryDate,
        price: price,
        status: "IN_STOCK" as InventoryStatus,
      }));

      const { error } = await supabase.from("inventory_units").insert(rows);
      if (error) throw error;

      toast.success(`Created ${count} unit(s)`);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to create units");
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!initial?.id) return;

    if (!manufactureDate) {
      toast.error("Manufacture date is required.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("inventory_units")
        .update({
          manufacture_date: manufactureDate,
          expiry_date: expiryDate || null,
          price: price,
          status: editStatus,
        })
        .eq("id", initial.id)
        .eq("vendor_id", vendorId);

      if (error) throw error;

      toast.success("Unit updated");
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Unit" : "Create Unit Batch"}</DialogTitle>
        </DialogHeader>

        {isEdit ? (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-1">Unit code</div>
              <Input value={initial?.unit_code ?? ""} readOnly />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Manufacture Date</div>
                <Input
                  type="date"
                  value={manufactureDate}
                  onChange={(e) => setManufactureDate(e.target.value)}
                />
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Expiry Date</div>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Price</div>
                <Input
                  type="number"
                  value={Number.isFinite(price) ? price : 0}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  min="0"
                />
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Status</div>
                <Input
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as InventoryStatus)}
                  placeholder="IN_STOCK / INVOICED / SOLD / OUT_OF_STOCK"
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Product Code (auto)</div>
                <Input value={productCode} readOnly placeholder="Loading…" />
                {productName ? (
                  <div className="text-xs text-muted-foreground mt-1">{productName}</div>
                ) : null}
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Brand Code (auto)</div>
                <Input value={brandCode} readOnly placeholder="Loading…" />
                {brandName ? (
                  <div className="text-xs text-muted-foreground mt-1">{brandName}</div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Manufacture Date</div>
                <Input
                  type="date"
                  value={manufactureDate}
                  onChange={(e) => setManufactureDate(e.target.value)}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Default: today - 1 year
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Expiry Date</div>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Default: today + 2 years
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Price (auto)</div>
                <Input
                  type="number"
                  value={Number.isFinite(price) ? price : 0}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  min="0"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Auto from product (editable)
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Units count (batch)</div>
                <Input
                  type="number"
                  value={unitsCount}
                  onChange={(e) => setUnitsCount(Number(e.target.value))}
                  min="1"
                />
                <div className="text-xs text-muted-foreground mt-1">
                  Example: 10
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Batch Base Code (auto)</div>
              <Input value={batchBaseCode} readOnly placeholder="Auto-generated" />
              <div className="text-xs text-muted-foreground mt-1">
                product_code&brand_code&manufacture_date&expiry_date&price
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Unit code preview</div>
              <div className="rounded-md border p-2 text-sm font-mono space-y-1">
                {batchBaseCode ? (
                  previewCodes.map((x) => <div key={x}>{x}</div>)
                ) : (
                  <div className="text-muted-foreground">Loading…</div>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Saved as BatchBaseCode-001, -002, ...
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          {isEdit ? (
            <Button onClick={saveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : (
            <Button
              onClick={createBatch}
              disabled={saving || loadingMeta || !batchBaseCode}
            >
              {saving ? "Creating…" : "Create units"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
