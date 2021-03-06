module Admin
  class TitlesController < AdminControllerBase
    def index
      @titles = Title
        .includes(:functions)
        .select("titles.*, count(inclusions.id) as inclusions_count")
          .joins(compositions: :inclusions)
          .group("titles.id")
        .order(:text)
        .page(params[:page])
        .per(50)

      @functions = Function.order(:name)
    end

    def update_all
      titles_to_update.each do |id, title_params|
        update_title(id, title_params)
      end

      redirect_to admin_titles_path(page: params[:page])
    end

    private

    def update_title(id, title_params)
      title = Title.find_by(id: id)
      return unless title

      title_params = title_params.permit(
        :text,
        function_ids: [],
      )

      title.assign_attributes(title_params)

      other_functions = []
      other_compositions = []
      if title.text_changed? && (other_title = Title.find_by(text: title.text))
        other_id = other_title.id.to_s

        if (other_update_params = titles_to_update[other_id])
          update_title(other_id, other_update_params)
        end

        other_functions = other_title.functions.to_a
        other_compositions = other_title.compositions.to_a
        other_title.destroy!
      end

      unless title.save
        errors = title.errors.full_messages
        flash[:error] ||= ""
        flash[:error] += "#{errors.to_sentence}\n"
      end

      title.update(functions: title.functions + other_functions)
      other_compositions.each {|c| c.update(title_id: title.id) }
    end

    def titles_to_update
      params.require(:titles)
    end
  end
end
