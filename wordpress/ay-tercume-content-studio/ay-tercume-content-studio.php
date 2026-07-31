<?php
/**
 * Plugin Name: AY Tercüme Content Studio Styles
 * Description: Loads the shared AY Tercüme article stylesheet and protects Content Studio managed posts from being edited outside the panel.
 * Version: 1.0.0
 * Author: AY Tercüme
 */

if (!defined('ABSPATH')) {
    exit;
}

define('AY_CONTENT_STUDIO_MARKER_PREFIX', '<!-- TTAA_CONTENT_JOB:');

/**
 * Optional: define AY_CONTENT_STUDIO_API_USER in wp-config.php with the
 * Application Password username Content Studio authenticates as, so manual
 * logins under that same account are still treated as external edits.
 * When left undefined, any authenticated REST API request is trusted,
 * because Content Studio is the only integration using this REST API.
 */

function ay_content_studio_has_article(): bool {
    if (!is_singular()) {
        return false;
    }

    $post = get_queried_object();
    return $post instanceof WP_Post && strpos((string) $post->post_content, 'class="ayc-article"') !== false;
}

function ay_content_studio_enqueue_styles(): void {
    if (!ay_content_studio_has_article()) {
        return;
    }

    wp_enqueue_style(
        'ay-tercume-article',
        plugin_dir_url(__FILE__) . 'assets/css/ay-tercume-article.css',
        array(),
        '1.0.0'
    );
}
add_action('wp_enqueue_scripts', 'ay_content_studio_enqueue_styles');

function ay_content_studio_enqueue_editor_styles(): void {
    if (!is_admin()) {
        return;
    }

    wp_enqueue_style(
        'ay-tercume-article-editor',
        plugin_dir_url(__FILE__) . 'assets/css/ay-tercume-article.css',
        array(),
        '1.0.0'
    );
}
add_action('enqueue_block_assets', 'ay_content_studio_enqueue_editor_styles');

function ay_content_studio_is_managed_post(int $post_id): bool {
    if ($post_id <= 0) {
        return false;
    }
    $content = get_post_field('post_content', $post_id);
    return is_string($content) && strpos($content, AY_CONTENT_STUDIO_MARKER_PREFIX) !== false;
}

function ay_content_studio_is_service_request(): bool {
    if (!defined('REST_REQUEST') || !REST_REQUEST) {
        return false;
    }
    if (!defined('AY_CONTENT_STUDIO_API_USER') || AY_CONTENT_STUDIO_API_USER === '') {
        return true;
    }
    $current = wp_get_current_user();
    return $current && $current->exists() && $current->user_login === AY_CONTENT_STUDIO_API_USER;
}

/**
 * Server-side guarantee: the article body of a Content Studio managed post
 * can only change through Content Studio's own REST sync. Manual saves from
 * the classic editor, Gutenberg's "Update" button, or XML-RPC keep the
 * previously synced HTML untouched.
 */
function ay_content_studio_lock_body(array $data, array $postarr): array {
    $post_id = isset($postarr['ID']) ? (int) $postarr['ID'] : 0;
    if ($post_id <= 0 || ay_content_studio_is_service_request()) {
        return $data;
    }
    if (!ay_content_studio_is_managed_post($post_id)) {
        return $data;
    }
    $data['post_content'] = get_post_field('post_content', $post_id);
    return $data;
}
add_filter('wp_insert_post_data', 'ay_content_studio_lock_body', 10, 2);

function ay_content_studio_admin_notice(): void {
    global $post;
    if (!$post instanceof WP_Post || !ay_content_studio_is_managed_post($post->ID)) {
        return;
    }
    $panel_url = defined('AY_CONTENT_STUDIO_PANEL_URL') ? AY_CONTENT_STUDIO_PANEL_URL : '';
    echo '<div class="notice notice-info"><p><strong>Bu içerik Content Studio üzerinden düzenlenir.</strong> Gövde metni panelden güncellenmeden bu ekrandan yapılan değişiklikler kaydedilmez.';
    if ($panel_url !== '') {
        echo ' <a href="' . esc_url($panel_url) . '" target="_blank" rel="noopener">Panelde aç</a>';
    }
    echo '</p></div>';
}
add_action('admin_notices', 'ay_content_studio_admin_notice');

/**
 * Visual lock: disable the classic/Gutenberg content editor for managed
 * posts so editors see the restriction before attempting to save.
 */
function ay_content_studio_lock_editor_ui(): void {
    global $post;
    if (!$post instanceof WP_Post || !ay_content_studio_is_managed_post($post->ID)) {
        return;
    }
    ?>
    <style>
        #postdivrich, .wp-block-post-content, .block-editor-writing-flow { opacity: .55; pointer-events: none; }
    </style>
    <script>
        (function () {
            var notice = document.createElement('div');
            notice.textContent = 'İçerik Content Studio tarafından yönetiliyor. Gövdeyi panelden düzenleyin.';
            notice.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;background:#0f0b08;color:#fff;padding:10px 14px;border-radius:8px;font:600 12px sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.2)';
            document.addEventListener('DOMContentLoaded', function () {
                document.body.appendChild(notice);
            });
        })();
    </script>
    <?php
}
add_action('admin_footer-post.php', 'ay_content_studio_lock_editor_ui');
add_action('admin_footer-post-new.php', 'ay_content_studio_lock_editor_ui');
