export const addSecurityHeaders = (req, res, next) => {
  // Using a more permissive Content-Security-Policy to allow cross-origin requests
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src *; img-src * data:;"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
};
