// src/types/templates.ts
// ---------------------------------------------
// Tipos base compartidos de Templates
// ---------------------------------------------

export type DocType = "quote" | "confirmation" | "voucher";

// ========= Agency / User (para preview/runtime) =========
export type AgencySocials = Partial<{
  instagram: string;
  facebook: string;
  twitter: string;
  tiktok: string;
}>;

export type Agency = {
  id?: number;
  id_agency?: number;
  name?: string;
  legal_name?: string;
  logo_url?: string;
  address?: string;
  website?: string;
  /** Teléfono “principal” opcional (coincide con tu modelo Prisma) */
  phone?: string;
  /** Lista de teléfonos adicionales */
  phones?: string[];
  emails?: string[];
  /** Backward/legacy shape (API devuelve `social`) */
  social?: AgencySocials;
  socials?: AgencySocials;
};

export type CurrentUser = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string | null;
};

// ========= UI tokens =========
export type Density = "compact" | "comfortable" | "relaxed";

export type BlockTextSize = "xs" | "sm" | "base" | "lg" | "xl" | "2xl";
export type BlockTextWeight =
  | "light"
  | "normal"
  | "medium"
  | "semibold"
  | "bold";
export type BlockTextStyle = {
  size?: BlockTextSize;
  weight?: BlockTextWeight;
};

// ========= Bloques de contenido =========
export type BlockType =
  | "heading"
  | "subtitle"
  | "paragraph"
  | "list"
  | "keyValue"
  | "twoColumns"
  | "threeColumns";

export type BlockMode = "fixed" | "form";

export type MupuStyle = {
  color?: string;
  target?: "all" | "keys" | "values"; // solo keyValue
};

export type BaseBlock = {
  id: string;
  type: BlockType;
  mode: BlockMode;
  label?: string;
  fieldKey?: string; // cuando el contenido se completa via formulario
  mupuStyle?: MupuStyle; // overrides Mupu (opcional)
  textStyle?: BlockTextStyle;
};

export type HeadingBlock = BaseBlock & {
  type: "heading";
  text?: string;
  level?: 1 | 2 | 3;
};
export type SubtitleBlock = BaseBlock & { type: "subtitle"; text?: string };
export type ParagraphBlock = BaseBlock & { type: "paragraph"; text?: string };
export type ListBlock = BaseBlock & { type: "list"; items?: string[] };
export type KeyValueBlock = BaseBlock & {
  type: "keyValue";
  pairs?: { key: string; value: string }[];
};
export type TwoColumnsBlock = BaseBlock & {
  type: "twoColumns";
  left?: string;
  right?: string;
};
export type ThreeColumnsBlock = BaseBlock & {
  type: "threeColumns";
  left?: string;
  center?: string;
  right?: string;
};

export type ContentBlock =
  | HeadingBlock
  | SubtitleBlock
  | ParagraphBlock
  | ListBlock
  | KeyValueBlock
  | TwoColumnsBlock
  | ThreeColumnsBlock;

// ========= Config maestro (persistente por doc_type) =========
export type TemplateConfig = {
  styles?: {
    colors?: { background?: string; text?: string; accent?: string };
    fonts?: { heading?: string; body?: string };
    ui?: {
      radius?: "sm" | "md" | "lg" | "xl" | "2xl";
      density?: Density;
      contentWidth?: "narrow" | "normal" | "wide";
      dividers?: boolean;
    };
    /** Nota informativa arriba del documento (opcional) */
    note?: string;
  };
  layout?: "layoutA" | "layoutB" | "layoutC";
  coverImage?: {
    /** "logo" | "url" */
    mode?: string;
    /** URL seleccionada (cuando mode === 'url') */
    url?: string;
    /** Colección de URLs disponibles para elegir en el Form */
    urls?: string[];
  };
  /** Tipos de contacto que el template puede mostrar */
  contactItems?: string[]; // ["phones","email","website","address","instagram","facebook","twitter","tiktok"]

  content?: { blocks?: ContentBlock[] };

  /** Opciones de pago definidas por el template */
  paymentOptions?: string[];

  /** Vista previa/estado: selección (solo para runtime, NO necesario persistir aquí) */
  payment?: {
    selectedIndex?: number;
    mupuStyle?: { color?: string };
  };
};

// ========= Valores que arma el usuario (form por documento) =========
// - Elecciones de portada/contacto/pago
// - Valores para bloques "form"
// - Bloques agregados y orden final

export type HeadingFormValue = { text?: string; level?: 1 | 2 | 3 };
export type SubtitleFormValue = { text?: string };
export type ParagraphFormValue = { text?: string };
export type ListFormValue = { items?: string[] };
export type KeyValueFormValue = { pairs?: { key: string; value: string }[] };
export type TwoColumnsFormValue = { left?: string; right?: string };
export type ThreeColumnsFormValue = {
  left?: string;
  center?: string;
  right?: string;
};

export type BlockFormValue =
  | ({ type: "heading" } & HeadingFormValue)
  | ({ type: "subtitle" } & SubtitleFormValue)
  | ({ type: "paragraph" } & ParagraphFormValue)
  | ({ type: "list" } & ListFormValue)
  | ({ type: "keyValue" } & KeyValueFormValue)
  | ({ type: "twoColumns" } & TwoColumnsFormValue)
  | ({ type: "threeColumns" } & ThreeColumnsFormValue);

export type OrderedBlock = {
  id: string;
  /** "fixed" = del config, "form" = del config pero editable, "extra" = creado por el usuario */
  origin: "fixed" | "form" | "extra";
  type: BlockType;
  /** Para origin === "form" | "extra": valor del usuario */
  value?: BlockFormValue;
  /** Opcionalmente un alias/etiqueta visible de bloque */
  label?: string;
  textStyle?: BlockTextStyle;
};

export type TemplateFormValues = {
  cover?: {
    mode?: "logo" | "url";
    url?: string; // cuando mode === "url"
  };
  /**
   * Datos de contacto elegidos para mostrar.
   * Preferimos strings directas (resueltas) para simplificar el render.
   * Si necesitás backrefs a arrays de agencia, podés usar los *_Index opcionales.
   */
  contact?: {
    website?: string;
    address?: string;
    phone?: string;
    email?: string;
    instagram?: string;
    facebook?: string;
    twitter?: string;
    tiktok?: string;

    // Referencias opcionales a índices de arrays (si tus componentes lo usan)
    phoneIndex?: number;
    emailIndex?: number;
    instagramIndex?: number;
    facebookIndex?: number;
    twitterIndex?: number;
    tiktokIndex?: number;
  };
  payment?: { selectedIndex?: number };

  /** Orden final a renderizar (incluye fijos, form y extra) */
  blocks?: OrderedBlock[];
};

// ========= Resultado de merge para preview/runtime =========
export type RuntimeResolved = {
  /** Config normalizado (con estilos/layout/etc) */
  config: TemplateConfig;
  /** Agencia resuelta (con los datos seleccionados por el usuario como prioridad) */
  agency: Agency;
  /** Usuario actual (sin cambios) */
  user: CurrentUser;
};
