package dev.kubelearn.api.auth;

import java.time.Duration;

import jakarta.mail.MessagingException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;

import dev.kubelearn.api.KubelearnProperties;

/**
 * Sends the sign-in email over SMTP (Mailpit locally). Asynchronous, so the request
 * returns at once and its timing never depends on the mail server.
 */
@Component
class SmtpMagicLinkMailer implements MagicLinkMailer {

	private static final Logger log = LoggerFactory.getLogger(SmtpMagicLinkMailer.class);

	private final JavaMailSender mail;

	private final KubelearnProperties props;

	private final boolean production;

	SmtpMagicLinkMailer(JavaMailSender mail, KubelearnProperties props, Environment env) {
		this.mail = mail;
		this.props = props;
		this.production = env.acceptsProfiles(Profiles.of("prod"));
	}

	@Async
	@Override
	public void send(String email, String link, Duration validFor) {
		try {
			var message = mail.createMimeMessage();
			var helper = new MimeMessageHelper(message, true, "UTF-8");
			helper.setFrom(props.mailFrom());
			helper.setTo(email);
			helper.setSubject("Your KubeLearn sign-in link");
			helper.setText(text(link, validFor), html(email, link, validFor));
			mail.send(message);
		}
		catch (MailException | MessagingException ex) {
			log.warn("Could not send sign-in email to {}: {}", email, ex.getMessage());
			if (!production) {
				// so local development never gets stuck without a mail server
				log.info("Sign-in link for {}: {}", email, link);
			}
		}
	}

	static String text(String link, Duration validFor) {
		return """
				Sign in to KubeLearn

				Open this link to sign in. It works once and expires in %d minutes:
				%s

				If you didn't ask for this, ignore this email — nothing happens.
				""".formatted(validFor.toMinutes(), link);
	}

	static String html(String email, String link, Duration validFor) {
		var to = HtmlUtils.htmlEscape(email);
		var href = HtmlUtils.htmlEscape(link);
		return """
				<!doctype html>
				<html><body style="margin:0;background:#0b0d11;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e6e9ef">
				<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
				<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#11151b;border:1px solid #232a35;border-radius:14px">
				<tr><td style="padding:32px 32px 8px">
				<div style="font-size:13px;font-weight:600;color:#8aaeff">&#11041; KubeLearn</div>
				<h1 style="margin:18px 0 8px;font-size:21px;font-weight:600;color:#e6e9ef">Sign in to KubeLearn</h1>
				<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#9aa3b2">Click the button to sign in as <strong style="color:#e6e9ef">%s</strong>. Your progress follows you to every device.</p>
				<a href="%s" style="display:inline-block;background:#8aaeff;color:#0b1020;font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:9px">Sign in</a>
				<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6b7383">The link works once and expires in %d minutes. If you didn't ask for it, ignore this email — nothing happens.</p>
				</td></tr>
				<tr><td style="padding:20px 32px 28px"><p style="margin:0;font-size:11px;line-height:1.5;color:#4f5766;word-break:break-all">%s</p></td></tr>
				</table></td></tr></table>
				</body></html>
				""".formatted(to, href, validFor.toMinutes(), href);
	}

}
