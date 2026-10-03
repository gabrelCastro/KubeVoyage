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
			helper.setSubject("Seu link de acesso ao KubeLearn");
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
				Entre no KubeLearn

				Abra este link para entrar. Ele funciona uma vez e expira em %d minutos:
				%s

				Se você não solicitou este link, ignore este e-mail — nada acontecerá.
				""".formatted(validFor.toMinutes(), link);
	}

	static String html(String email, String link, Duration validFor) {
		var to = HtmlUtils.htmlEscape(email);
		var href = HtmlUtils.htmlEscape(link);
		return """
				<!doctype html>
				<html lang="pt-BR"><body style="margin:0;background:#0b0d11;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e6e9ef">
				<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
				<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#11151b;border:1px solid #232a35;border-radius:14px">
				<tr><td style="padding:32px 32px 8px">
				<div style="font-size:13px;font-weight:600;color:#8aaeff">&#11041; KubeLearn</div>
				<h1 style="margin:18px 0 8px;font-size:21px;font-weight:600;color:#e6e9ef">Entre no KubeLearn</h1>
				<p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#9aa3b2">Clique no botão para entrar como <strong style="color:#e6e9ef">%s</strong>. Seu progresso acompanha você em todos os dispositivos.</p>
				<a href="%s" style="display:inline-block;background:#8aaeff;color:#0b1020;font-size:14px;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:9px">Entrar</a>
				<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6b7383">O link funciona uma vez e expira em %d minutos. Se você não o solicitou, ignore este e-mail — nada acontecerá.</p>
				</td></tr>
				<tr><td style="padding:20px 32px 28px"><p style="margin:0;font-size:11px;line-height:1.5;color:#4f5766;word-break:break-all">%s</p></td></tr>
				</table></td></tr></table>
				</body></html>
				""".formatted(to, href, validFor.toMinutes(), href);
	}

}
