import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor(private readonly auth: AuthService) {
    this.auth.createUser({
      name: 'admin',
      password: 'admin',
      isAdmin: true,
    }).catch(() => {
      // Ignore error if user already exists
    });
  }
  protected readonly title = signal('uixprotocol');
}
