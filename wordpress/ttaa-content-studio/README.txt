TTAA Content Studio Styles
==========================

Install once from WordPress Admin > Plugins > Add New > Upload Plugin.

The plugin loads assets/css/translation-article.css only on singular posts whose content contains the TTAA article wrapper. Generated article HTML therefore stays compact and does not repeat the stylesheet on every post.

SEO title, meta description and canonical URL are written separately through the active AIOSEO REST integration.

Version 1.1 adds responsive styling for generated inline article images.

Version 1.3 adds server-side protection: posts synced from Content Studio cannot have their article body changed through the normal WordPress editor. Manual admin saves are reverted to the last Content Studio revision; only Content Studio's own REST sync can update the body. An admin notice on the post edit screen explains this and links to the panel.

Optional wp-config.php constants:
  define('TTAA_CONTENT_STUDIO_API_USER', 'your-application-password-username');
  define('TTAA_CONTENT_STUDIO_PANEL_URL', 'https://your-content-studio-domain/');
