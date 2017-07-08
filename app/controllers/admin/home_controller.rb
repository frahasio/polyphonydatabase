module Admin
  class HomeController < AdminControllerBase
    def index; end

  private

    def sources
      @sources ||= Source.all
    end

    def composers
      @composers ||= Composer.all
    end
  end
end
