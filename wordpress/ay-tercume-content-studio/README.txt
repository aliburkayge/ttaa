AY Tercüme Content Studio Styles
=================================

Install once from WordPress Admin > Plugins > Add New > Upload Plugin, on the aytercume.com WordPress site only.

The plugin loads assets/css/ay-tercume-article.css only on singular posts whose content contains the AY article wrapper (class="ayc-article"). It never touches TTAA class names or the turkishtranslation.com.tr site.

SEO title, meta description and canonical URL are written separately through the active AIOSEO REST integration.

Version 1.0 adds server-side protection: posts synced from Content Studio cannot have their article body changed through the normal WordPress editor. Manual admin saves are reverted to the last Content Studio revision; only Content Studio's own REST sync can update the body. An admin notice on the post edit screen explains this and links to the panel.

Optional wp-config.php constants:
  define('AY_CONTENT_STUDIO_API_USER', 'your-application-password-username');
  define('AY_CONTENT_STUDIO_PANEL_URL', 'https://your-content-studio-domain/ay-tercume');
