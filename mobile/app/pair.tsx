import { Redirect } from 'expo-router'

// Why: +native-intent rewrites OS links before routing; this route never reads a pairing code.
export default function PairRedirectScreen() {
  return <Redirect href="/pair-scan" />
}
