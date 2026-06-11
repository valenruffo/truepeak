import { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const targetDomain = 'https://www.truepeak.space';

  // Static routes
  const staticRoutes = [
    '',
    '/guide',
    '/login',
    '/register',
    '/privacy-policy',
    '/refund-policy',
    '/terms-of-service',
  ];

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((route) => ({
    url: `${targetDomain}${route}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: route === '' ? 1.0 : 0.8,
  }));

  let dynamicEntries: MetadataRoute.Sitemap = [];
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://164.152.194.196:8000';
    const res = await fetch(`${apiUrl}/api/labels/public/slugs`, {
      next: { revalidate: 3600 }
    });
    if (res.ok) {
      const slugs = await res.json();
      if (Array.isArray(slugs)) {
        dynamicEntries = slugs.map((slug: string) => ({
          url: `${targetDomain}/s/${slug}`,
          lastModified: new Date(),
          changeFrequency: 'weekly',
          priority: 0.6,
        }));
      }
    }
  } catch (error) {
    console.error('Failed to fetch dynamic slugs for sitemap:', error);
  }

  return [...staticEntries, ...dynamicEntries];
}

