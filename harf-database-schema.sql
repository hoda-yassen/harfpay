-- ============================================
-- DATABASE SCHEMA FOR HARF PLATFORM
-- منصة حرف - هيكل قاعدة البيانات
-- ============================================

-- Create Database
CREATE DATABASE IF NOT EXISTS harf_platform;
USE harf_platform;

-- ============================================
-- 1. USERS TABLE (جدول المستخدمين)
-- ============================================
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    bio TEXT,
    profile_image_url VARCHAR(255),
    is_verified BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(100),
    verification_code_expires TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    user_type ENUM('reader', 'writer', 'admin') DEFAULT 'reader',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token_hash VARCHAR(255),
    verification_expires TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_username (username),
    INDEX idx_created_at (created_at)
);

-- ============================================
-- 2. WRITER PROFILES TABLE (ملفات الكتاب الشخصية)
-- ============================================
CREATE TABLE writer_profiles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL UNIQUE,
    bio_full TEXT,
    social_facebook VARCHAR(255),
    social_twitter VARCHAR(255),
    social_instagram VARCHAR(255),
    social_linkedin VARCHAR(255),
    website_url VARCHAR(255),
    specializations VARCHAR(500), -- التخصصات
    follower_count INT DEFAULT 0,
    article_count INT DEFAULT 0,
    total_views INT DEFAULT 0,
    total_likes INT DEFAULT 0,
    rating DECIMAL(3, 2) DEFAULT 0,
    is_featured BOOLEAN DEFAULT FALSE,
    badge_level ENUM('bronze', 'silver', 'gold', 'platinum') DEFAULT 'bronze',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_follower_count (follower_count),
    INDEX idx_article_count (article_count)
);

-- ============================================
-- 3. CATEGORIES TABLE (جدول التصنيفات)
-- ============================================
CREATE TABLE categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon VARCHAR(50),
    color_code VARCHAR(7),
    article_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    display_order INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_slug (slug),
    INDEX idx_article_count (article_count)
);

-- ============================================
-- 4. ARTICLES TABLE (جدول المقالات)
-- ============================================
CREATE TABLE articles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    category_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    content LONGTEXT NOT NULL,
    featured_image_url VARCHAR(255),
    reading_time_minutes INT,
    view_count INT DEFAULT 0,
    shares_count INT NOT NULL DEFAULT 0,
    CONSTRAINT chk_shares_count_nonnegative CHECK (shares_count >= 0),
    like_count INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    share_count INT DEFAULT 0,
    is_published BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    status ENUM('draft', 'pending_review', 'published', 'rejected') DEFAULT 'draft',
    seo_title VARCHAR(255),
    seo_description VARCHAR(255),
    seo_keywords VARCHAR(255),
    seo_score INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    published_at TIMESTAMP NULL,
    rejection_reason TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
    INDEX idx_user_id (user_id),
    INDEX idx_category_id (category_id),
    INDEX idx_slug (slug),
    INDEX idx_published_at (published_at),
    INDEX idx_view_count (view_count),
    INDEX idx_is_published (is_published),
    FULLTEXT INDEX ft_title (title),
    FULLTEXT INDEX ft_content (content)
    ,CHECK (CHAR_LENGTH(title) BETWEEN 1 AND 100)
    ,CHECK (CHAR_LENGTH(description) <= 160)
    ,CHECK (CHAR_LENGTH(content) BETWEEN 1500 AND 50000)
);

-- ============================================
-- 4.1 RPM RATES BY COUNTRY (أسعار المشاهدة بالدولار)
-- ============================================
CREATE TABLE rpm_rates (
    country_code VARCHAR(7) PRIMARY KEY,
    country_name VARCHAR(100) NOT NULL,
    rpm_usd DECIMAL(10, 4) NOT NULL DEFAULT 0.5000,
    is_active BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CHECK (rpm_usd >= 0)
);

INSERT INTO rpm_rates (country_code, country_name, rpm_usd) VALUES
('US', 'الولايات المتحدة', 1.5000), ('CA', 'كندا', 1.2500),
('GB', 'المملكة المتحدة', 1.2000), ('AU', 'أستراليا', 1.1500),
('AE', 'الإمارات', 0.7500), ('SA', 'السعودية', 0.6000),
('EG', 'مصر', 0.5000), ('DE', 'ألمانيا', 1.1000),
('FR', 'فرنسا', 0.9500), ('DEFAULT', 'الدول الأخرى', 0.5000);

-- سعر RPM بالدولار يُحفظ مع كل مشاهدة لأغراض التدقيق.
CREATE TABLE view_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    article_id INT NOT NULL,
    user_id INT NOT NULL,
    country_code VARCHAR(7) NOT NULL,
    rpm_usd DECIMAL(10, 4) NOT NULL,
    earning_usd DECIMAL(12, 8) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_view_events_article (article_id),
    INDEX idx_view_events_country (country_code)
);

-- ============================================
-- 5. ARTICLE STATISTICS TABLE (إحصائيات المقالات)
-- ============================================
CREATE TABLE article_statistics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    article_id INT NOT NULL UNIQUE,
    daily_views INT DEFAULT 0,
    weekly_views INT DEFAULT 0,
    monthly_views INT DEFAULT 0,
    bounce_rate DECIMAL(5, 2) DEFAULT 0,
    average_reading_time INT DEFAULT 0,
    traffic_sources JSON,
    device_types JSON,
    geographic_data JSON,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- ============================================
-- 6. COMMENTS TABLE (جدول التعليقات)
-- ============================================
CREATE TABLE comments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    article_id INT NOT NULL,
    user_id INT NOT NULL,
    parent_comment_id INT,
    content TEXT NOT NULL,
    is_approved BOOLEAN DEFAULT FALSE,
    like_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    INDEX idx_article_id (article_id),
    INDEX idx_user_id (user_id),
    INDEX idx_approved (is_approved)
);

-- ============================================
-- 7. LIKES TABLE (جدول الإعجابات)
-- ============================================
CREATE TABLE likes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    article_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_like (article_id, user_id),
    INDEX idx_user_id (user_id)
);

-- ============================================
-- 8. FOLLOWERS TABLE (جدول المتابعين)
-- ============================================
CREATE TABLE followers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    writer_id INT NOT NULL,
    follower_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (writer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_follow (writer_id, follower_id),
    INDEX idx_writer_id (writer_id),
    INDEX idx_follower_id (follower_id)
);

-- ============================================
-- 9. BOOKMARKS/SAVED ARTICLES TABLE (جدول المقالات المحفوظة)
-- ============================================
CREATE TABLE bookmarks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    article_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    UNIQUE KEY unique_bookmark (user_id, article_id),
    INDEX idx_user_id (user_id)
);

-- ============================================
-- 10. USER EARNINGS TABLE (جدول أرباح الكاتب)
-- ============================================
CREATE TABLE user_earnings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL UNIQUE,
    total_earnings DECIMAL(12, 2) DEFAULT 0,
    available_balance DECIMAL(12, 2) DEFAULT 0,
    pending_balance DECIMAL(12, 2) DEFAULT 0,
    total_views INT DEFAULT 0,
    earnings_from_ads DECIMAL(12, 2) DEFAULT 0,
    earnings_from_referrals DECIMAL(12, 2) DEFAULT 0,
    cpm_rate DECIMAL(5, 2) DEFAULT 0.5, -- Cost per 1000 views
    last_payout TIMESTAMP,
    last_payout_amount DECIMAL(12, 2),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_available_balance (available_balance)
);

-- ============================================
-- 10.1 SPONSORED PINNING (تثبيت المقال المدفوع)
-- ============================================
CREATE TABLE promotions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    article_id INT NOT NULL,
    user_id INT NOT NULL,
    days INT NOT NULL,
    daily_price_usd DECIMAL(10, 4) NOT NULL DEFAULT 0.5000,
    total_price_usd DECIMAL(12, 4) NOT NULL,
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP NOT NULL,
    status ENUM('active', 'expired', 'cancelled') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CHECK (days >= 3),
    CHECK (daily_price_usd = 0.5000),
    CHECK (total_price_usd = days * daily_price_usd),
    INDEX idx_promotions_active (status, starts_at, ends_at),
    INDEX idx_promotions_article (article_id)
);

CREATE TABLE withdrawal_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    method ENUM('vodafone_cash', 'instapay', 'bank_transfer', 'paypal') NOT NULL,
    payment_details VARCHAR(255) NOT NULL,
    status ENUM('pending', 'approved', 'processing', 'completed', 'rejected') DEFAULT 'pending',
    transaction_id VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
);

-- ============================================
-- USER PAYMENT ACCOUNTS (حسابات السحب الخاصة بالكاتب)
-- ============================================
CREATE TABLE payment_accounts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    method ENUM('vodafone_cash', 'etisalat_cash', 'instapay', 'tilda', 'airtm') NOT NULL,
    account_value_encrypted TEXT NOT NULL,
    account_last_digits VARCHAR(8) NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_user_payment_method (user_id, method),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- 12. FRAUD DETECTION TABLE (كشف الاحتيال)
-- ============================================
CREATE TABLE fraud_detection (
    id INT PRIMARY KEY AUTO_INCREMENT,
    article_id INT NOT NULL,
    user_id INT NOT NULL,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    view_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_suspicious BOOLEAN DEFAULT FALSE,
    fraud_score INT DEFAULT 0, -- 0-100
    reason TEXT,
    is_excluded BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_article_id (article_id),
    INDEX idx_is_suspicious (is_suspicious),
    INDEX idx_ip_address (ip_address)
);

-- ============================================
-- 13. VIEW TRACKING TABLE (تتبع المشاهدات)
-- ============================================
CREATE TABLE view_tracking (
    id INT PRIMARY KEY AUTO_INCREMENT,
    article_id INT NOT NULL,
    user_id INT,
    ip_address VARCHAR(45),
    user_agent VARCHAR(255),
    referrer VARCHAR(255),
    device_type ENUM('mobile', 'tablet', 'desktop') DEFAULT 'desktop',
    country VARCHAR(100),
    city VARCHAR(100),
    view_duration_seconds INT,
    view_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    INDEX idx_article_id (article_id),
    INDEX idx_view_timestamp (view_timestamp),
    INDEX idx_ip_address (ip_address)
);

-- ============================================
-- 14. SUPPORT TICKETS TABLE (تذاكر الدعم)
-- ============================================
CREATE TABLE support_tickets (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    category ENUM('technical', 'payment', 'content', 'account', 'other') DEFAULT 'other',
    status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    assigned_to INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_priority (priority)
);

-- ============================================
-- 15. SUPPORT MESSAGES TABLE (رسائل الدعم)
-- ============================================
CREATE TABLE support_messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ticket_id INT NOT NULL,
    sender_id INT NOT NULL,
    message TEXT NOT NULL,
    attachment_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_ticket_id (ticket_id)
);

-- ============================================
-- 16. NOTIFICATIONS TABLE (الإشعارات)
-- ============================================
CREATE TABLE notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    type ENUM('new_article', 'new_comment', 'new_follower', 'payment', 'message', 'system') DEFAULT 'system',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    related_article_id INT,
    related_user_id INT,
    is_read BOOLEAN DEFAULT FALSE,
    action_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (related_article_id) REFERENCES articles(id) ON DELETE SET NULL,
    FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_created_at (created_at)
);

-- ============================================
-- 17. ADMIN LOGS TABLE (سجلات الإدارة)
-- ============================================
CREATE TABLE admin_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    admin_id INT NOT NULL,
    action VARCHAR(255) NOT NULL,
    target_type ENUM('user', 'article', 'comment', 'payment', 'ticket') NOT NULL,
    target_id INT,
    description TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_admin_id (admin_id),
    INDEX idx_created_at (created_at)
);

-- ============================================
-- INSERT DEFAULT CATEGORIES (التصنيفات الافتراضية)
-- ============================================
INSERT INTO categories (name, slug, description, icon, color_code, display_order) VALUES
('تقنية', 'technology', 'المقالات التقنية والبرمجة والذكاء الاصطناعي', '💻', '#1a5f5f', 1),
('تعليم', 'education', 'التعليم والدراسة والمهارات', '📚', '#3498db', 2),
('صحة وجمال', 'health-beauty', 'الصحة والعافية والجمال', '💚', '#e74c3c', 3),
('فن وثقافة', 'art-culture', 'الفن والثقافة والأدب', '🎨', '#9b59b6', 4),
('سفر ورحلات', 'travel', 'السفر والرحلات والسياحة', '✈️', '#1abc9c', 5),
('طبخ وغذاء', 'cooking', 'الطبخ والوصفات والتغذية', '👨‍🍳', '#f39c12', 6),
('رياضة', 'sports', 'الرياضة واللياقة البدنية', '⚽', '#e67e22', 7),
('عقارات', 'real-estate', 'العقارات والإسكان', '🏠', '#34495e', 8),
('سيارات', 'cars', 'السيارات والمحركات', '🚗', '#c0392b', 9),
('أعمال', 'business', 'الأعمال والريادة', '💼', '#16a085', 10),
('استثمار', 'investment', 'الاستثمار والأموال', '💰', '#27ae60', 11),
('قانون', 'law', 'القانون والحقوق', '⚖️', '#2c3e50', 12),
('علوم', 'science', 'العلوم والاكتشافات', '🔬', '#8e44ad', 13),
('بيئة', 'environment', 'البيئة والاستدامة', '🌱', '#16a085', 14),
('نمط حياة', 'lifestyle', 'نمط الحياة والعادات', '🌟', '#f1c40f', 15),
('أطفال', 'kids', 'محتوى الأطفال والعائلة', '👶', '#e91e63', 16),
('مجتمع', 'community', 'المجتمع والعلاقات الاجتماعية', '👥', '#3498db', 17),
('سياسة', 'politics', 'السياسة والحكومة', '🏛️', '#34495e', 18),
('تنمية ذاتية', 'self-development', 'التنمية الذاتية والمهارات', '🚀', '#e74c3c', 19),
('علاقات', 'relationships', 'العلاقات والحب', '💕', '#e91e63', 20),
('ترفيه', 'entertainment', 'الترفيه والسينما والموسيقى', '🎬', '#9b59b6', 21),
('أخبار', 'news', 'الأخبار والأحداث الجارية', '📰', '#e74c3c', 22);

-- ============================================
-- CREATE INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_articles_published ON articles(is_published, published_at);
CREATE INDEX idx_articles_featured ON articles(is_featured, view_count);
CREATE INDEX idx_earnings_available ON user_earnings(available_balance);
CREATE INDEX idx_views_article_date ON view_tracking(article_id, view_timestamp);

-- ============================================
-- BASIC STORED PROCEDURES
-- ============================================

-- Update User Earnings based on Views
DELIMITER //
CREATE PROCEDURE UpdateUserEarnings()
BEGIN
    UPDATE user_earnings ue
    JOIN articles a ON a.user_id = ue.user_id
    SET ue.total_views = (SELECT COUNT(*) FROM view_tracking vt
                         WHERE vt.article_id = a.id
                         AND vt.view_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY))
    WHERE ue.updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR);
END//
DELIMITER ;

-- Update Article View Count
DELIMITER //
CREATE PROCEDURE UpdateArticleViews()
BEGIN
    UPDATE articles a
    SET a.view_count = (SELECT COUNT(*) FROM view_tracking vt
                       WHERE vt.article_id = a.id
                       AND NOT EXISTS (
                           SELECT 1 FROM fraud_detection fd
                           WHERE fd.article_id = vt.article_id
                           AND fd.user_id = vt.user_id
                           AND fd.is_excluded = TRUE
                       ))
    WHERE a.updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR);
END//
DELIMITER ;

-- ============================================
-- DATABASE COMMENTS
-- ============================================
-- This is the complete database schema for the Harf Platform
-- A professional Arabic article publishing platform
-- With complete features: User management, Articles, Earnings, Fraud detection, Support
-- Total: 17 tables with comprehensive relationships and indexes
