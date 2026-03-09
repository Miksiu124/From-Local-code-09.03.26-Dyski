"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Calculator } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { convertPlnToUsd } from "@/lib/utils";

export function CurrencyConverter() {
  const t = useTranslations("credits");
  const [plnInput, setPlnInput] = useState("");

  const pln = parseFloat(plnInput) || 0;
  const usd = convertPlnToUsd(pln);

  return (
    <Card className="border-border/50 bg-muted/30">
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
          <Calculator className="h-4 w-4" />
          {t("converterTitle")}
        </div>
        <p className="text-lg font-semibold text-foreground mb-3">{t("converterRate")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">{t("converterPln")}</label>
            <Input
              type="number"
              min={0}
              step={0.01}
              placeholder="0"
              value={plnInput}
              onChange={(e) => setPlnInput(e.target.value)}
              className="w-24 h-9"
            />
          </div>
          <span className="text-muted-foreground">=</span>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">{t("converterUsd")}</label>
            <span className="font-medium tabular-nums min-w-[4rem]">
              {pln > 0 ? usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
