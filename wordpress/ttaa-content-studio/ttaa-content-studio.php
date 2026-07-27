<?php
/**
 * Plugin Name: TTAA Content Studio Styles
 * Description: Loads the shared TTAA article stylesheet once for Content Studio posts.
 * Version: 1.2.0
 * Author: Turkish Translation & Attestation Agency
 */

if (!defined('ABSPATH')) {
    exit;
}

function ttaa_content_studio_has_article(): bool {
    if (!is_singular()) {
        return false;
    }

    $post = get_queried_object();
    return $post instanceof WP_Post && strpos((string) $post->post_content, 'class="ttaa-article"') !== false;
}

function ttaa_content_studio_enqueue_styles(): void {
    if (!ttaa_content_studio_has_article()) {
        return;
    }

    wp_enqueue_style(
        'ttaa-translation-article',
        plugin_dir_url(__FILE__) . 'assets/css/translation-article.css',
        array(),
        '1.2.0'
    );
}
add_action('wp_enqueue_scripts', 'ttaa_content_studio_enqueue_styles');

function ttaa_content_studio_enqueue_editor_styles(): void {
    if (!is_admin()) {
        return;
    }

    wp_enqueue_style(
        'ttaa-translation-article-editor',
        plugin_dir_url(__FILE__) . 'assets/css/translation-article.css',
        array(),
        '1.2.0'
    );
}
add_action('enqueue_block_assets', 'ttaa_content_studio_enqueue_editor_styles');
