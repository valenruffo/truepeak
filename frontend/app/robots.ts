import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/crm',
          '/inbox',
          '/config',
          '/settings',
          '/api',
          '/vercel-api',
        ],
      },
    ],
    sitemap: 'https://www.truepeak.space/sitemap.xml',
  };
}
