module Admin
  class EditionsController < AdminControllerBase
    def index
      groups = Group.order(:display_title)
      groups = GroupFilter.new(params).filter(groups)
      groups = groups.includes(
        compositions: [
          :composers,
          :title,
          inclusions: [
            :source,
          ]
        ],
      )

      @groups = groups.limit(200)
    end

    def update_for_group
      group = Group.find(params[:group_id])

      unless group.update(group_params)
        flash[:error] = group.errors.full_messages.to_sentence
      end

      redirect_to admin_editions_path(request.query_parameters.except(:group_id))
    end

    private

    def group_params
      params.require(:group).permit(
        editions_attributes: [
          :editor_id,
          :file_url,
          :has_pdf,
          :id,
          :voicing,
        ]
      )
    end
  end
end
