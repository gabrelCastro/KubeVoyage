package dev.kubelearn.api.common;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** No API payload is legitimately bigger than a few KB; refuse anything large up front. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class BodySizeLimitFilter extends OncePerRequestFilter {

	static final long MAX_BYTES = 64 * 1024;

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		return !request.getRequestURI().startsWith("/api/");
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		if (request.getContentLengthLong() > MAX_BYTES) {
			response.setStatus(HttpStatus.CONTENT_TOO_LARGE.value());
			response.setContentType("application/problem+json");
			response.getWriter()
				.write("{\"type\":\"https://kubelearn.dev/problems/too_large\",\"title\":\"Content Too Large\",\"status\":413,\"code\":\"too_large\",\"detail\":\"Request body is too large.\"}");
			return;
		}
		chain.doFilter(request, response);
	}

}
