import type {
  ForeverPassport,
  PassportRenderTarget,
  SerializedForeverPassport,
} from "./passport-types";

type SerializeForeverPassportOptions = {
  renderTarget?: PassportRenderTarget;
  serializedAt?: string;
};

export function serializeForeverPassport(
  passport: ForeverPassport,
  options: SerializeForeverPassportOptions = {},
): SerializedForeverPassport {
  return {
    metadata: {
      ...passport.metadata,
      serializedAt: options.serializedAt ?? new Date().toISOString(),
      renderTarget: options.renderTarget,
    },
    passport,
  };
}

export function serializeForeverPassportToJson(
  passport: ForeverPassport,
  options: SerializeForeverPassportOptions = {},
): string {
  return JSON.stringify(serializeForeverPassport(passport, options), null, 2);
}
