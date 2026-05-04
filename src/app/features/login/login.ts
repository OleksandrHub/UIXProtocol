import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  name = '';
  password = '';
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);


  constructor() {
    if (this.auth.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
  }

  async onSubmit(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      await this.auth.login(this.name, this.password);
      this.router.navigate(['/dashboard']);
    } catch (e: unknown) {
      this.error.set(this.formatError(e));
    } finally {
      this.loading.set(false);
    }
  }

  private formatError(e: unknown): string {
    if (typeof e === 'object' && e !== null && 'error' in e) {
      const err = (e as { error?: { error?: string } }).error;
      if (err?.error) return err.error;
    }
    return e instanceof Error ? e.message : 'Login failed';
  }
}
