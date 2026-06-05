FROM php:8.2-apache

# Install MySQL extension (if needed)
RUN docker-php-ext-install pdo pdo_mysql mysqli

# Copy your application files
COPY . /var/www/html/

# Ensure Apache starts and health check file exists
RUN echo "OK" > /var/www/html/health

# Set permissions
RUN chown -R www-data:www-data /var/www/html && chmod -R 755 /var/www/html

# Enable mod_rewrite (optional)
RUN a2enmod rewrite

# Expose port 80
EXPOSE 80