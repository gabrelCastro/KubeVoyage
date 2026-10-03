package dev.kubelearn.api;

import org.springframework.boot.SpringApplication;

public class TestKubelearnApiApplication {

	public static void main(String[] args) {
		SpringApplication.from(KubelearnApiApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
