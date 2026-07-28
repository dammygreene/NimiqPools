import { KeyPair, MnemonicUtils } from "@nimiq/core";

export const NIMIQ_STANDARD_ACCOUNT_PATH = "m/44'/242'/0'";
export const NIMIQ_STANDARD_ACCOUNT_INDEX = 0;

export type DerivedSigningWallet = {
  address: string;
  keyPair: InstanceType<typeof KeyPair>;
};

export function deriveSigningWalletFromMnemonic(mnemonic: string): DerivedSigningWallet {
  const extendedKey = MnemonicUtils.mnemonicToExtendedPrivateKey(mnemonic);
  const accountKey = extendedKey.derivePath(NIMIQ_STANDARD_ACCOUNT_PATH);
  const signingKey = accountKey.derive(NIMIQ_STANDARD_ACCOUNT_INDEX);
  return {
    address: signingKey.toAddress().toUserFriendlyAddress(),
    keyPair: KeyPair.derive(signingKey.privateKey),
  };
}
