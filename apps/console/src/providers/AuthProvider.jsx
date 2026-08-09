import { use } from 'react';
import AuthJwtProvider, { AuthJwtContext } from './auth-provider/AuthJwtProvider';

/**
 * Authentication.
 *
 * Aurora shipped swappable JWT / Auth0 / Firebase providers plus a social-auth
 * wrapper. AEGIS authenticates one way -- JWT against its own service, whose
 * tokens carry the role that scopes every API response -- so the indirection
 * is gone and this is a thin re-export.
 */
const AuthProvider = ({ children }) => <AuthJwtProvider>{children}</AuthJwtProvider>;

export const useAuth = () => use(AuthJwtContext);

export default AuthProvider;
